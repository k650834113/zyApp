import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { PERMISSIONS } from '@zyapp/auth'
import type {
  CashierCommandStatus,
  CompleteEmployeeFinancialCommandRequest,
  EmployeeFinancialCommandExecution,
  EmployeeFinancialCommandResult,
  EmployeeFinancialCommandSummary,
  EmployeeFinancialCommandType,
  EmployeeMobileCreateFinancialCommandRequest,
  FailCashierCommandRequest,
  RenewCashierCommandResult
} from '@zyapp/contracts'
import type { Pool, PoolClient } from '@zyapp/cloud-db'
import { createHash, randomUUID } from 'node:crypto'
import type { DevicePrincipal } from './device-auth'
import { POSTGRES_POOL } from './infrastructure.module'
import type { MiniappPrincipal } from './miniapp-auth'

type FinancialCommandRow = {
  id: string
  request_id: string
  request_hash: string
  command_type: EmployeeFinancialCommandType
  status: CashierCommandStatus
  requested_by: string
  command_json: EmployeeMobileCreateFinancialCommandRequest
  claimed_by_device: string | null
  lease_expires_at: Date | string | null
  result_json: EmployeeFinancialCommandResult | null
  error_message: string | null
  expires_at: Date | string
  created_at: Date | string
  completed_at: Date | string | null
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/
const COMMAND_TTL_MINUTES = 10
const LEASE_SECONDS = 45

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }
  return value as Record<string, unknown>
}

function uuid(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new Error(`${fieldName}格式不正确`)
  }
  return value.trim().toLowerCase()
}

function requestId(value: unknown): string {
  if (typeof value !== 'string') throw new Error('请求编号不能为空')
  const normalized = value.trim()
  if (
    normalized.length < 8 ||
    normalized.length > 100 ||
    !REQUEST_ID_PATTERN.test(normalized)
  ) {
    throw new Error('请求编号格式不正确')
  }
  return normalized
}

function reason(
  value: unknown,
  fallback: string,
  required = false
): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error('操作原因不能为空')
    return fallback
  }
  if (typeof value !== 'string') throw new Error('操作原因必须是文字')
  const normalized = value.trim()
  if (normalized.length < (required ? 2 : 0) || normalized.length > 200) {
    throw new Error(
      required
        ? '操作原因长度应为 2 至 200 个字符'
        : '操作备注不能超过 200 个字符'
    )
  }
  return normalized || fallback
}

function parseCreate(
  value: unknown
): EmployeeMobileCreateFinancialCommandRequest {
  const input = object(value, '财务操作请求格式不正确')
  const id = requestId(input.requestId)
  if (input.type === 'cash_recharge') {
    if (!Number.isSafeInteger(input.principalFen) || Number(input.principalFen) <= 0) {
      throw new Error('充值金额必须是大于 0 的整数分')
    }
    return {
      requestId: id,
      type: input.type,
      memberId: uuid(input.memberId, '会员编号'),
      principalFen: Number(input.principalFen),
      reason: reason(input.reason, '移动端现金充值')
    }
  }
  if (input.type === 'monthly_card_purchase') {
    return {
      requestId: id,
      type: input.type,
      memberId: uuid(input.memberId, '会员编号'),
      reason: reason(input.reason, '移动端现金购买月卡')
    }
  }
  if (
    input.type === 'monthly_card_pause' ||
    input.type === 'monthly_card_resume'
  ) {
    return {
      requestId: id,
      type: input.type,
      cardId: uuid(input.cardId, '月卡编号'),
      reason: reason(input.reason, '', true)
    }
  }
  if (input.type === 'apply_activity_recharge_tiers') {
    return {
      requestId: id,
      type: input.type,
      activityId: uuid(input.activityId, '活动编号'),
      reason: reason(input.reason, '', true)
    }
  }
  throw new Error('财务操作类型不正确')
}

function parseCompletion(
  value: unknown
): CompleteEmployeeFinancialCommandRequest {
  const input = object(value, '完成结果格式不正确')
  const result = object(input.result, '财务结果格式不正确')
  if (
    result.type !== 'cash_recharge' &&
    result.type !== 'monthly_card_purchase' &&
    result.type !== 'monthly_card_pause' &&
    result.type !== 'monthly_card_resume' &&
    result.type !== 'apply_activity_recharge_tiers'
  ) {
    throw new Error('财务结果类型不正确')
  }
  if (
    result.type === 'cash_recharge' &&
    (!result.wallet || typeof result.wallet !== 'object')
  ) {
    throw new Error('充值结果不完整')
  }
  if (
    result.type !== 'cash_recharge' &&
    result.type !== 'apply_activity_recharge_tiers' &&
    (!result.monthlyCard || typeof result.monthlyCard !== 'object')
  ) {
    throw new Error('月卡结果不完整')
  }
  if (
    result.type === 'apply_activity_recharge_tiers' &&
    !Array.isArray(result.rechargeGiftTiers)
  ) {
    throw new Error('充值赠送档位结果不完整')
  }
  return { result: input.result as EmployeeFinancialCommandResult }
}

function parseFailure(value: unknown): FailCashierCommandRequest {
  const input = object(value, '失败结果格式不正确')
  if (typeof input.errorMessage !== 'string') {
    throw new Error('失败原因不能为空')
  }
  const errorMessage = input.errorMessage.trim()
  if (errorMessage.length < 1 || errorMessage.length > 500) {
    throw new Error('失败原因长度应为 1 至 500 个字符')
  }
  return { errorMessage }
}

function summary(row: FinancialCommandRow): EmployeeFinancialCommandSummary {
  return {
    commandId: row.id,
    requestId: row.request_id,
    type: row.command_type,
    status: row.status,
    requestedBy: row.requested_by,
    claimedByDevice: row.claimed_by_device,
    result: row.result_json,
    errorMessage: row.error_message,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    completedAt:
      row.completed_at === null
        ? null
        : new Date(row.completed_at).toISOString()
  }
}

function employeeId(principal: MiniappPrincipal): string {
  if (
    !principal.employeeId ||
    (principal.identity.role !== 'staff' &&
      principal.identity.role !== 'manager')
  ) {
    throw new ForbiddenException('当前身份没有员工操作权限')
  }
  return principal.employeeId
}

function permissionFor(type: EmployeeFinancialCommandType): string {
  if (type === 'cash_recharge') return PERMISSIONS.walletRechargeCash
  if (type === 'apply_activity_recharge_tiers') {
    return PERMISSIONS.activityManage
  }
  return PERMISSIONS.monthlyCardManage
}

function sameResult(
  existing: EmployeeFinancialCommandResult | null,
  incoming: EmployeeFinancialCommandResult | null
): boolean {
  if (!existing || !incoming || existing.type !== incoming.type) return false
  if (incoming.type === 'cash_recharge') {
    return (
      existing.type === 'cash_recharge' &&
      existing.wallet.operationId === incoming.wallet.operationId
    )
  }
  if (incoming.type === 'apply_activity_recharge_tiers') {
    return (
      existing.type === 'apply_activity_recharge_tiers' &&
      JSON.stringify(existing.rechargeGiftTiers) ===
        JSON.stringify(incoming.rechargeGiftTiers)
    )
  }
  return (
    existing.type !== 'cash_recharge' &&
    existing.type !== 'apply_activity_recharge_tiers' &&
    existing.monthlyCard.id === incoming.monthlyCard.id &&
    existing.monthlyCard.status === incoming.monthlyCard.status
  )
}

@Injectable()
export class EmployeeFinancialCommandService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async create(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<EmployeeFinancialCommandSummary> {
    let input: EmployeeMobileCreateFinancialCommandRequest
    try {
      input = parseCreate(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '财务操作请求不正确'
      )
    }
    const requestedBy = employeeId(principal)
    const permissions =
      principal.identity.role === 'staff' ||
      principal.identity.role === 'manager'
        ? principal.identity.permissions
        : []
    if (!permissions.includes(permissionFor(input.type))) {
      throw new ForbiddenException('当前身份没有此财务操作权限')
    }
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ ...input, requestId: undefined }))
      .digest('hex')
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.validateReference(client, principal, input)
      const commandId = randomUUID()
      const inserted = await client.query<FinancialCommandRow>(
        `INSERT INTO employee_financial_command
         (id, tenant_id, store_id, requested_by, request_id, request_hash,
          command_type, command_json, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb,
                 CURRENT_TIMESTAMP + INTERVAL '${COMMAND_TTL_MINUTES} minutes')
         ON CONFLICT (tenant_id, requested_by, request_id) DO NOTHING
         RETURNING *`,
        [
          commandId,
          principal.tenantId,
          principal.storeId,
          requestedBy,
          input.requestId,
          requestHash,
          input.type,
          JSON.stringify(input)
        ]
      )
      let row = inserted.rows[0]
      if (!row) {
        const previous = await client.query<FinancialCommandRow>(
          `SELECT * FROM employee_financial_command
           WHERE tenant_id = $1 AND requested_by = $2 AND request_id = $3
           FOR UPDATE`,
          [principal.tenantId, requestedBy, input.requestId]
        )
        row = previous.rows[0]
        if (!row || row.request_hash !== requestHash) {
          throw new ConflictException('同一请求号已用于不同的财务操作')
        }
        await client.query('COMMIT')
        return summary(row)
      }
      await this.audit(client, {
        tenantId: principal.tenantId,
        storeId: principal.storeId,
        actorId: requestedBy,
        action: 'employee_financial_command.created',
        commandId,
        metadata: {
          identityId: principal.identityId,
          commandType: input.type
        }
      })
      await client.query('COMMIT')
      return summary(row)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async get(
    principal: MiniappPrincipal,
    commandId: string
  ): Promise<EmployeeFinancialCommandSummary> {
    const requestedBy = employeeId(principal)
    const id = this.commandId(commandId)
    await this.expireCommands()
    const result = await this.pool.query<FinancialCommandRow>(
      `SELECT * FROM employee_financial_command
       WHERE id = $1 AND tenant_id = $2 AND store_id = $3
         AND requested_by = $4`,
      [id, principal.tenantId, principal.storeId, requestedBy]
    )
    const row = result.rows[0]
    if (!row) throw new NotFoundException('财务操作命令不存在')
    return summary(row)
  }

  async cancel(
    principal: MiniappPrincipal,
    commandId: string
  ): Promise<EmployeeFinancialCommandSummary> {
    const requestedBy = employeeId(principal)
    const id = this.commandId(commandId)
    const result = await this.pool.query<FinancialCommandRow>(
      `UPDATE employee_financial_command
       SET status = 'canceled', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND tenant_id = $2 AND store_id = $3
         AND requested_by = $4 AND status = 'pending'
         AND expires_at > CURRENT_TIMESTAMP
       RETURNING *`,
      [id, principal.tenantId, principal.storeId, requestedBy]
    )
    const row = result.rows[0]
    if (!row) {
      const existing = await this.get(principal, id)
      throw new ConflictException(
        existing.status === 'claimed'
          ? 'PC 已领取该操作，不能取消'
          : '当前状态不能取消该操作'
      )
    }
    await this.audit(this.pool, {
      tenantId: principal.tenantId,
      storeId: principal.storeId,
      actorId: requestedBy,
      action: 'employee_financial_command.canceled',
      commandId: id,
      metadata: { commandType: row.command_type }
    })
    return summary(row)
  }

  async claim(
    device: DevicePrincipal
  ): Promise<EmployeeFinancialCommandExecution | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.expireCommands(client)
      const selected = await client.query<FinancialCommandRow>(
        `SELECT * FROM employee_financial_command
         WHERE tenant_id = $1 AND store_id = $2 AND status = 'pending'
           AND expires_at > CURRENT_TIMESTAMP
         ORDER BY created_at, id
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [device.tenantId, device.storeId]
      )
      const pending = selected.rows[0]
      if (!pending) {
        await client.query('COMMIT')
        return null
      }
      const claimed = await client.query<FinancialCommandRow>(
        `UPDATE employee_financial_command
         SET status = 'claimed', claimed_by_device = $2,
             claimed_at = CURRENT_TIMESTAMP,
             lease_expires_at =
               CURRENT_TIMESTAMP + INTERVAL '${LEASE_SECONDS} seconds',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [pending.id, device.deviceId]
      )
      const row = claimed.rows[0]
      if (!row || row.lease_expires_at === null) {
        throw new Error('Financial command claim did not return a lease')
      }
      await this.audit(client, {
        tenantId: device.tenantId,
        storeId: device.storeId,
        actorId: null,
        action: 'employee_financial_command.claimed',
        commandId: row.id,
        metadata: {
          deviceId: device.deviceId,
          commandType: row.command_type
        }
      })
      await client.query('COMMIT')
      return {
        commandId: row.id,
        requestedBy: row.requested_by,
        request: { ...row.command_json, requestId: row.id },
        leaseExpiresAt: new Date(row.lease_expires_at).toISOString(),
        expiresAt: new Date(row.expires_at).toISOString()
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async renew(
    device: DevicePrincipal,
    commandId: string
  ): Promise<RenewCashierCommandResult> {
    const id = this.commandId(commandId)
    const result = await this.pool.query<{
      id: string
      lease_expires_at: Date | string
    }>(
      `UPDATE employee_financial_command
       SET lease_expires_at =
             CURRENT_TIMESTAMP + INTERVAL '${LEASE_SECONDS} seconds',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND tenant_id = $2 AND store_id = $3
         AND status = 'claimed' AND claimed_by_device = $4
         AND expires_at > CURRENT_TIMESTAMP
       RETURNING id, lease_expires_at`,
      [id, device.tenantId, device.storeId, device.deviceId]
    )
    const row = result.rows[0]
    if (!row) throw new ConflictException('财务操作命令租约已经失效')
    return {
      commandId: row.id,
      leaseExpiresAt: new Date(row.lease_expires_at).toISOString()
    }
  }

  async complete(
    device: DevicePrincipal,
    commandId: string,
    rawInput: unknown
  ): Promise<EmployeeFinancialCommandSummary> {
    let input: CompleteEmployeeFinancialCommandRequest
    try {
      input = parseCompletion(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '财务结果不正确'
      )
    }
    return this.finish(device, commandId, {
      status: 'completed',
      result: input.result,
      errorMessage: null
    })
  }

  async fail(
    device: DevicePrincipal,
    commandId: string,
    rawInput: unknown
  ): Promise<EmployeeFinancialCommandSummary> {
    let input: FailCashierCommandRequest
    try {
      input = parseFailure(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '失败结果不正确'
      )
    }
    return this.finish(device, commandId, {
      status: 'failed',
      result: null,
      errorMessage: input.errorMessage
    })
  }

  private async finish(
    device: DevicePrincipal,
    commandId: string,
    outcome: {
      status: 'completed' | 'failed'
      result: EmployeeFinancialCommandResult | null
      errorMessage: string | null
    }
  ): Promise<EmployeeFinancialCommandSummary> {
    const id = this.commandId(commandId)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const selected = await client.query<FinancialCommandRow>(
        `SELECT * FROM employee_financial_command
         WHERE id = $1 AND tenant_id = $2 AND store_id = $3
         FOR UPDATE`,
        [id, device.tenantId, device.storeId]
      )
      const current = selected.rows[0]
      if (!current) throw new NotFoundException('财务操作命令不存在')
      if (outcome.result && outcome.result.type !== current.command_type) {
        throw new ConflictException('财务结果类型与原操作不一致')
      }
      if (current.status === outcome.status) {
        const existingResult = current.result_json
        const same =
          outcome.status === 'completed'
            ? sameResult(existingResult, outcome.result)
            : current.error_message === outcome.errorMessage
        if (!same) {
          throw new ConflictException('财务操作命令已经提交其他结果')
        }
        await client.query('COMMIT')
        return summary(current)
      }
      if (
        (current.status !== 'claimed' &&
          current.status !== 'pending' &&
          current.status !== 'expired') ||
        (current.status === 'claimed' &&
          current.claimed_by_device !== device.deviceId) ||
        (current.status === 'expired' &&
          current.claimed_by_device !== null &&
          current.claimed_by_device !== device.deviceId)
      ) {
        throw new ConflictException('当前设备没有该命令的有效领取权')
      }
      const updated = await client.query<FinancialCommandRow>(
        `UPDATE employee_financial_command
         SET status = $2, result_json = $3::jsonb, error_message = $4,
             completed_at = CURRENT_TIMESTAMP, lease_expires_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [
          id,
          outcome.status,
          outcome.result === null ? null : JSON.stringify(outcome.result),
          outcome.errorMessage
        ]
      )
      const row = updated.rows[0]
      if (!row) throw new Error('Financial command result was not saved')
      await this.audit(client, {
        tenantId: device.tenantId,
        storeId: device.storeId,
        actorId: row.requested_by,
        action: `employee_financial_command.${outcome.status}`,
        commandId: id,
        metadata: {
          deviceId: device.deviceId,
          commandType: row.command_type,
          errorMessage: outcome.errorMessage
        }
      })
      await client.query('COMMIT')
      return summary(row)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async validateReference(
    client: PoolClient,
    principal: MiniappPrincipal,
    input: EmployeeMobileCreateFinancialCommandRequest
  ): Promise<void> {
    if ('activityId' in input) {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM cloud_activity_campaign
         WHERE id = $1 AND tenant_id = $2 AND store_id = $3
           AND activity_type = 'recharge'
           AND jsonb_array_length(recharge_tiers_json) > 0
         LIMIT 1`,
        [input.activityId, principal.tenantId, principal.storeId]
      )
      if (!result.rows[0]) {
        throw new BadRequestException(
          '只有包含赠送档位的充值活动可以应用为当前规则'
        )
      }
      return
    }
    if ('memberId' in input) {
      const result = await client.query<{ age_gate_status: string }>(
        `SELECT age_gate_status FROM cloud_member
         WHERE id = $1 AND tenant_id = $2
           AND status = 'active'
         LIMIT 1`,
        [input.memberId, principal.tenantId, principal.storeId]
      )
      const member = result.rows[0]
      if (!member) throw new BadRequestException('会员不存在或已停用')
      if (
        input.type === 'cash_recharge' &&
        member.age_gate_status === 'recharge_disabled'
      ) {
        throw new BadRequestException('该会员当前禁止储值')
      }
      return
    }
    const result = await client.query<{ id: string }>(
      `SELECT id FROM cloud_monthly_card
       WHERE id = $1 AND tenant_id = $2 AND store_id = $3
       LIMIT 1`,
      [input.cardId, principal.tenantId, principal.storeId]
    )
    if (!result.rows[0]) {
      throw new BadRequestException(
        input.type === 'monthly_card_pause'
          ? '月卡不存在或当前不能暂停'
          : '月卡不存在或当前不能恢复'
      )
    }
  }

  private async expireCommands(
    queryable: Pick<Pool, 'query'> | PoolClient = this.pool
  ): Promise<void> {
    await queryable.query(
      `UPDATE employee_financial_command
       SET status = 'expired', lease_expires_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE status IN ('pending', 'claimed')
         AND expires_at <= CURRENT_TIMESTAMP`
    )
    await queryable.query(
      `UPDATE employee_financial_command
       SET status = 'pending', claimed_by_device = NULL, claimed_at = NULL,
           lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE status = 'claimed' AND lease_expires_at <= CURRENT_TIMESTAMP
         AND expires_at > CURRENT_TIMESTAMP`
    )
  }

  private commandId(value: string): string {
    try {
      return uuid(value, '财务操作命令编号')
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '财务操作命令编号不正确'
      )
    }
  }

  private async audit(
    queryable: Pick<Pool, 'query'> | PoolClient,
    input: {
      tenantId: string
      storeId: string
      actorId: string | null
      action: string
      commandId: string
      metadata: Record<string, unknown>
    }
  ): Promise<void> {
    await queryable.query(
      `INSERT INTO cloud_audit_log
       (id, tenant_id, store_id, actor_id, action, aggregate_type,
        aggregate_id, metadata_json)
       VALUES ($1, $2, $3, $4, $5, 'employee_financial_command',
               $6, $7::jsonb)`,
      [
        randomUUID(),
        input.tenantId,
        input.storeId,
        input.actorId,
        input.action,
        input.commandId,
        JSON.stringify(input.metadata)
      ]
    )
  }
}
