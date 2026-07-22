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
  CashierCommandExecution,
  CashierCommandSummary,
  CatalogItemSummary,
  CompleteCashierCommandRequest,
  CreateOrderLineRequest,
  CreateSalesOrderRequest,
  FailCashierCommandRequest,
  RenewCashierCommandResult,
  SalesOrderSummary
} from '@zyapp/contracts'
import type { Pool, PoolClient } from '@zyapp/cloud-db'
import { createHash, randomUUID } from 'node:crypto'
import type { DevicePrincipal } from './device-auth'
import { POSTGRES_POOL } from './infrastructure.module'
import type { MiniappPrincipal } from './miniapp-auth'

type CashierCommandRow = {
  id: string
  request_id: string
  request_hash: string
  status: CashierCommandSummary['status']
  requested_by: string
  command_json: CreateSalesOrderRequest
  claimed_by_device: string | null
  lease_expires_at: Date | string | null
  local_order_id: string | null
  result_json: SalesOrderSummary | null
  error_message: string | null
  expires_at: Date | string
  created_at: Date | string
  completed_at: Date | string | null
}

type CatalogRow = {
  id: string
  code: string
  name: string
  item_type: CatalogItemSummary['itemType']
  regular_price_fen: number | string
  advanced_price_fen: number | string
  status: CatalogItemSummary['status']
  availability: CatalogItemSummary['availability']
  note: string | null
  created_at: Date | string
  updated_at: Date | string
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

function optionalUuid(value: unknown, fieldName: string): string | undefined {
  return value === undefined || value === null || value === ''
    ? undefined
    : uuid(value, fieldName)
}

function safePositiveFen(value: unknown, fieldName: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${fieldName}必须是大于 0 的整数分`)
  }
  return Number(value)
}

function quantity(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 999) {
    throw new Error('收费项目数量应为 1 至 999')
  }
  return Number(value)
}

function parseLine(value: unknown): CreateOrderLineRequest {
  const line = object(value, '收费项目格式不正确')
  if ('customName' in line) {
    if (typeof line.customName !== 'string') {
      throw new Error('自定义收款名称不能为空')
    }
    const customName = line.customName.trim()
    if (customName.length < 1 || customName.length > 60) {
      throw new Error('自定义收款名称长度应为 1 至 60 个字符')
    }
    if (line.pricingTier !== undefined && line.pricingTier !== 'regular') {
      throw new Error('自定义收款不支持会员价')
    }
    return {
      customName,
      customUnitPriceFen: safePositiveFen(
        line.customUnitPriceFen,
        '自定义收款金额'
      ),
      quantity: quantity(line.quantity),
      pricingTier: 'regular'
    }
  }
  const pricingTier = line.pricingTier
  if (pricingTier !== 'regular' && pricingTier !== 'advanced') {
    throw new Error('收费项目价格类型不正确')
  }
  if (
    line.personalAdmissionBenefit !== undefined &&
    typeof line.personalAdmissionBenefit !== 'boolean'
  ) {
    throw new Error('本人入场权益标记不正确')
  }
  return {
    catalogItemId: uuid(line.catalogItemId, '收费项目编号'),
    quantity: quantity(line.quantity),
    pricingTier,
    ...(line.personalAdmissionBenefit === true
      ? { personalAdmissionBenefit: true }
      : {})
  }
}

function parseCreateCommand(value: unknown): CreateSalesOrderRequest {
  const input = object(value, '收银请求格式不正确')
  if (typeof input.requestId !== 'string') {
    throw new Error('请求编号不能为空')
  }
  const requestId = input.requestId.trim()
  if (
    requestId.length < 8 ||
    requestId.length > 100 ||
    !REQUEST_ID_PATTERN.test(requestId)
  ) {
    throw new Error('请求编号格式不正确')
  }
  if (input.paymentMethod !== 'cash' && input.paymentMethod !== 'stored_value') {
    throw new Error('支付方式不正确')
  }
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100) {
    throw new Error('一张消费单需要包含 1 至 100 个收费项目')
  }
  const customerMemberId = optionalUuid(input.customerMemberId, '顾客会员编号')
  const walletMemberId = optionalUuid(input.walletMemberId, '储值账户会员编号')
  if (input.paymentMethod === 'stored_value' && !walletMemberId) {
    throw new Error('储值支付必须选择储值账户')
  }
  if (input.paymentMethod === 'cash' && walletMemberId) {
    throw new Error('现金支付不能携带储值账户')
  }
  const lines = input.lines.map(parseLine)
  const personalBenefits = lines.filter(
    (line) =>
      'personalAdmissionBenefit' in line &&
      line.personalAdmissionBenefit === true
  )
  if (personalBenefits.length > 1) {
    throw new Error('一张消费单只能使用一次本人入场权益')
  }
  if (personalBenefits.length > 0 && !customerMemberId) {
    throw new Error('使用本人入场权益必须选择顾客会员')
  }
  if (
    input.note !== undefined &&
    input.note !== null &&
    typeof input.note !== 'string'
  ) {
    throw new Error('订单备注必须是文字')
  }
  const note = typeof input.note === 'string' ? input.note.trim() : undefined
  if (note !== undefined && note.length > 500) {
    throw new Error('订单备注不能超过 500 个字符')
  }
  return {
    requestId,
    ...(customerMemberId ? { customerMemberId } : {}),
    paymentMethod: input.paymentMethod,
    ...(walletMemberId ? { walletMemberId } : {}),
    lines,
    ...(note ? { note } : {})
  }
}

function parseCompletion(value: unknown): CompleteCashierCommandRequest {
  const input = object(value, '完成结果格式不正确')
  const localOrderId = uuid(input.localOrderId, '本地订单编号')
  const result = object(input.result, '订单结果格式不正确')
  if (uuid(result.id, '订单结果编号') !== localOrderId) {
    throw new Error('本地订单编号与订单结果不一致')
  }
  if (
    typeof result.orderNumber !== 'string' ||
    result.orderNumber.trim().length < 1 ||
    result.status !== 'completed' ||
    !Number.isSafeInteger(result.totalFen) ||
    Number(result.totalFen) < 0 ||
    typeof result.completedAt !== 'string' ||
    !Array.isArray(result.items)
  ) {
    throw new Error('订单结果内容不完整')
  }
  return {
    localOrderId,
    result: input.result as SalesOrderSummary
  }
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

function summary(row: CashierCommandRow): CashierCommandSummary {
  return {
    commandId: row.id,
    requestId: row.request_id,
    status: row.status,
    requestedBy: row.requested_by,
    claimedByDevice: row.claimed_by_device,
    localOrderId: row.local_order_id,
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
      principal.identity.role !== 'manager') ||
    !principal.identity.permissions.includes(PERMISSIONS.orderCreate)
  ) {
    throw new ForbiddenException('当前身份没有收银权限')
  }
  return principal.employeeId
}

@Injectable()
export class CashierCommandService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async listCatalog(
    principal: MiniappPrincipal
  ): Promise<CatalogItemSummary[]> {
    employeeId(principal)
    const result = await this.pool.query<CatalogRow>(
      `SELECT id, code, name, item_type, regular_price_fen,
              advanced_price_fen, status, availability, note,
              created_at, updated_at
       FROM cloud_catalog_item
       WHERE tenant_id = $1 AND store_id = $2
         AND status = 'active' AND availability = 'available'
       ORDER BY CASE item_type WHEN 'admission' THEN 0 ELSE 1 END,
                name, id`,
      [principal.tenantId, principal.storeId]
    )
    return result.rows.map((row) => {
      const regularPriceFen = Number(row.regular_price_fen)
      const advancedPriceFen = Number(row.advanced_price_fen)
      if (
        !Number.isSafeInteger(regularPriceFen) ||
        !Number.isSafeInteger(advancedPriceFen)
      ) {
        throw new Error('Cloud catalog price is outside the safe integer range')
      }
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        itemType: row.item_type,
        regularPriceFen,
        advancedPriceFen,
        status: row.status,
        availability: row.availability,
        note: row.note,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      }
    })
  }

  async create(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<CashierCommandSummary> {
    const requestedBy = employeeId(principal)
    let input: CreateSalesOrderRequest
    try {
      input = parseCreateCommand(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '收银请求不正确'
      )
    }
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ ...input, requestId: undefined }))
      .digest('hex')
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.validateReferences(client, principal, input)
      const commandId = randomUUID()
      const inserted = await client.query<CashierCommandRow>(
        `INSERT INTO cashier_command
         (id, tenant_id, store_id, requested_by, request_id, request_hash,
          command_json, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb,
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
          JSON.stringify(input)
        ]
      )
      let row = inserted.rows[0]
      if (!row) {
        const previous = await client.query<CashierCommandRow>(
          `SELECT * FROM cashier_command
           WHERE tenant_id = $1 AND requested_by = $2 AND request_id = $3
           FOR UPDATE`,
          [principal.tenantId, requestedBy, input.requestId]
        )
        row = previous.rows[0]
        if (!row || row.request_hash !== requestHash) {
          throw new ConflictException('同一请求号已用于不同的收银内容')
        }
        await client.query('COMMIT')
        return summary(row)
      }
      await this.audit(client, {
        tenantId: principal.tenantId,
        storeId: principal.storeId,
        actorId: requestedBy,
        action: 'cashier_command.created',
        commandId,
        metadata: { identityId: principal.identityId }
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
  ): Promise<CashierCommandSummary> {
    const requestedBy = employeeId(principal)
    const id = this.commandId(commandId)
    await this.expireCommands()
    const result = await this.pool.query<CashierCommandRow>(
      `SELECT * FROM cashier_command
       WHERE id = $1 AND tenant_id = $2 AND store_id = $3
         AND requested_by = $4`,
      [id, principal.tenantId, principal.storeId, requestedBy]
    )
    const row = result.rows[0]
    if (!row) throw new NotFoundException('收银命令不存在')
    return summary(row)
  }

  async cancel(
    principal: MiniappPrincipal,
    commandId: string
  ): Promise<CashierCommandSummary> {
    const requestedBy = employeeId(principal)
    const id = this.commandId(commandId)
    const result = await this.pool.query<CashierCommandRow>(
      `UPDATE cashier_command
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
          ? 'PC 已领取该收银命令，不能取消'
          : '当前状态不能取消该收银命令'
      )
    }
    await this.audit(this.pool, {
      tenantId: principal.tenantId,
      storeId: principal.storeId,
      actorId: requestedBy,
      action: 'cashier_command.canceled',
      commandId: id,
      metadata: { identityId: principal.identityId }
    })
    return summary(row)
  }

  async claim(
    device: DevicePrincipal
  ): Promise<CashierCommandExecution | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.expireCommands(client)
      const selected = await client.query<CashierCommandRow>(
        `SELECT * FROM cashier_command
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
      const claimed = await client.query<CashierCommandRow>(
        `UPDATE cashier_command
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
        throw new Error('Cashier command claim did not return a lease')
      }
      await this.audit(client, {
        tenantId: device.tenantId,
        storeId: device.storeId,
        actorId: null,
        action: 'cashier_command.claimed',
        commandId: row.id,
        metadata: { deviceId: device.deviceId }
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
      `UPDATE cashier_command
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
    if (!row) throw new ConflictException('收银命令租约已经失效')
    return {
      commandId: row.id,
      leaseExpiresAt: new Date(row.lease_expires_at).toISOString()
    }
  }

  async complete(
    device: DevicePrincipal,
    commandId: string,
    rawInput: unknown
  ): Promise<CashierCommandSummary> {
    let input: CompleteCashierCommandRequest
    try {
      input = parseCompletion(rawInput)
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '订单结果不正确'
      )
    }
    return this.finish(device, commandId, {
      status: 'completed',
      localOrderId: input.localOrderId,
      result: input.result,
      errorMessage: null
    })
  }

  async fail(
    device: DevicePrincipal,
    commandId: string,
    rawInput: unknown
  ): Promise<CashierCommandSummary> {
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
      localOrderId: null,
      result: null,
      errorMessage: input.errorMessage
    })
  }

  private async finish(
    device: DevicePrincipal,
    commandId: string,
    outcome: {
      status: 'completed' | 'failed'
      localOrderId: string | null
      result: SalesOrderSummary | null
      errorMessage: string | null
    }
  ): Promise<CashierCommandSummary> {
    const id = this.commandId(commandId)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const selected = await client.query<CashierCommandRow>(
        `SELECT * FROM cashier_command
         WHERE id = $1 AND tenant_id = $2 AND store_id = $3
         FOR UPDATE`,
        [id, device.tenantId, device.storeId]
      )
      const current = selected.rows[0]
      if (!current) throw new NotFoundException('收银命令不存在')
      if (current.status === outcome.status) {
        const same =
          outcome.status === 'completed'
            ? current.local_order_id === outcome.localOrderId
            : current.error_message === outcome.errorMessage
        if (!same) throw new ConflictException('收银命令已经提交其他结果')
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
        throw new ConflictException('当前设备没有该收银命令的有效领取权')
      }
      const updated = await client.query<CashierCommandRow>(
        `UPDATE cashier_command
         SET status = $2, local_order_id = $3, result_json = $4::jsonb,
             error_message = $5, completed_at = CURRENT_TIMESTAMP,
             lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [
          id,
          outcome.status,
          outcome.localOrderId,
          outcome.result === null ? null : JSON.stringify(outcome.result),
          outcome.errorMessage
        ]
      )
      const row = updated.rows[0]
      if (!row) throw new Error('Cashier command result was not saved')
      await this.audit(client, {
        tenantId: device.tenantId,
        storeId: device.storeId,
        actorId: row.requested_by,
        action: `cashier_command.${outcome.status}`,
        commandId: id,
        metadata: {
          deviceId: device.deviceId,
          localOrderId: outcome.localOrderId,
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

  private async validateReferences(
    client: PoolClient,
    principal: MiniappPrincipal,
    input: CreateSalesOrderRequest
  ): Promise<void> {
    const memberIds = [
      input.customerMemberId,
      input.walletMemberId
    ].filter((value, index, values): value is string =>
      Boolean(value) && values.indexOf(value) === index
    )
    if (memberIds.length > 0) {
      const members = await client.query<{ id: string }>(
        `SELECT id FROM cloud_member
         WHERE tenant_id = $1 AND status = 'active'
           AND id = ANY($3::uuid[])`,
        [principal.tenantId, principal.storeId, memberIds]
      )
      if (members.rows.length !== memberIds.length) {
        throw new BadRequestException('选择的会员不存在或已停用')
      }
    }
    const catalogIds = input.lines
      .filter(
        (line): line is Extract<CreateOrderLineRequest, { catalogItemId: string }> =>
          'catalogItemId' in line
      )
      .map((line) => line.catalogItemId)
      .filter((value, index, values) => values.indexOf(value) === index)
    if (catalogIds.length > 0) {
      const items = await client.query<{ id: string }>(
        `SELECT item.id FROM cloud_catalog_item item
         LEFT JOIN cloud_catalog_store_config config
           ON config.tenant_id = item.tenant_id AND config.store_id = $2
          AND config.catalog_item_id = item.id
         WHERE item.tenant_id = $1
           AND COALESCE(config.status, item.status) = 'active'
           AND COALESCE(config.availability, item.availability) = 'available'
           AND item.id = ANY($3::uuid[])`,
        [principal.tenantId, principal.storeId, catalogIds]
      )
      if (items.rows.length !== catalogIds.length) {
        throw new BadRequestException('收费项目不存在、已停用或已售罄')
      }
    }
  }

  private async expireCommands(
    queryable: Pick<Pool, 'query'> | PoolClient = this.pool
  ): Promise<void> {
    await queryable.query(
      `UPDATE cashier_command
       SET status = 'expired', lease_expires_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE status IN ('pending', 'claimed')
         AND expires_at <= CURRENT_TIMESTAMP`
    )
    await queryable.query(
      `UPDATE cashier_command
       SET status = 'pending', claimed_by_device = NULL, claimed_at = NULL,
           lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE status = 'claimed' AND lease_expires_at <= CURRENT_TIMESTAMP
         AND expires_at > CURRENT_TIMESTAMP`
    )
  }

  private commandId(value: string): string {
    try {
      return uuid(value, '收银命令编号')
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '收银命令编号不正确'
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
       VALUES ($1, $2, $3, $4, $5, 'cashier_command', $6, $7::jsonb)`,
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
