import type { DatabaseSync } from 'node:sqlite'
import type { SalesOrderSummary } from '@zyapp/contracts'
import type { StoreContext } from './identity'

export type CashierCommandExecutionRecord =
  | {
      commandId: string
      requestedByEmployeeId: string
      status: 'completed'
      localOrderId: string
      result: SalesOrderSummary
      errorMessage: null
      reportedAt: string | null
      createdAt: string
      updatedAt: string
    }
  | {
      commandId: string
      requestedByEmployeeId: string
      status: 'failed'
      localOrderId: null
      result: null
      errorMessage: string
      reportedAt: string | null
      createdAt: string
      updatedAt: string
    }

type ExecutionRow = {
  command_id: string
  requested_by_employee_id: string
  status: 'completed' | 'failed'
  local_order_id: string | null
  result_json: string | null
  error_message: string | null
  reported_at: string | null
  created_at: string
  updated_at: string
}

function mapExecution(row: ExecutionRow): CashierCommandExecutionRecord {
  const shared = {
    commandId: row.command_id,
    requestedByEmployeeId: row.requested_by_employee_id,
    reportedAt: row.reported_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  if (row.status === 'completed') {
    if (!row.local_order_id || !row.result_json) {
      throw new Error('Completed cashier command execution is incomplete')
    }
    return {
      ...shared,
      status: 'completed',
      localOrderId: row.local_order_id,
      result: JSON.parse(row.result_json) as SalesOrderSummary,
      errorMessage: null
    }
  }
  if (!row.error_message) {
    throw new Error('Failed cashier command execution is incomplete')
  }
  return {
    ...shared,
    status: 'failed',
    localOrderId: null,
    result: null,
    errorMessage: row.error_message
  }
}

export function findCashierCommandExecution(
  database: DatabaseSync,
  context: StoreContext,
  commandId: string
): CashierCommandExecutionRecord | null {
  const row = database
    .prepare(
      `SELECT command_id, requested_by_employee_id, status, local_order_id,
              result_json, error_message, reported_at, created_at, updated_at
       FROM cashier_command_execution
       WHERE command_id = ? AND tenant_id = ? AND store_id = ?`
    )
    .get(commandId, context.tenantId, context.storeId) as
    | ExecutionRow
    | undefined
  return row ? mapExecution(row) : null
}

export function listPendingCashierCommandReports(
  database: DatabaseSync,
  context: StoreContext,
  limit = 20
): CashierCommandExecutionRecord[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('Cashier command report limit must be between 1 and 100')
  }
  const rows = database
    .prepare(
      `SELECT command_id, requested_by_employee_id, status, local_order_id,
              result_json, error_message, reported_at, created_at, updated_at
       FROM cashier_command_execution
       WHERE tenant_id = ? AND store_id = ? AND reported_at IS NULL
       ORDER BY created_at, command_id
       LIMIT ?`
    )
    .all(context.tenantId, context.storeId, limit) as ExecutionRow[]
  return rows.map(mapExecution)
}

export function recordCompletedCashierCommandInOpenTransaction(
  database: DatabaseSync,
  context: StoreContext,
  input: {
    commandId: string
    requestedByEmployeeId: string
    order: SalesOrderSummary
    timestamp?: string
  }
): CashierCommandExecutionRecord {
  const timestamp = input.timestamp ?? new Date().toISOString()
  const existing = findCashierCommandExecution(
    database,
    context,
    input.commandId
  )
  if (existing) {
    if (
      existing.status !== 'completed' ||
      existing.localOrderId !== input.order.id
    ) {
      throw new Error('Cashier command already has a different local result')
    }
    return existing
  }
  database
    .prepare(
      `INSERT INTO cashier_command_execution
       (command_id, tenant_id, store_id, device_id,
        requested_by_employee_id, status, local_order_id, result_json,
        error_message, reported_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, NULL, NULL, ?, ?)`
    )
    .run(
      input.commandId,
      context.tenantId,
      context.storeId,
      context.deviceId,
      input.requestedByEmployeeId,
      input.order.id,
      JSON.stringify(input.order),
      timestamp,
      timestamp
    )
  const result = findCashierCommandExecution(
    database,
    context,
    input.commandId
  )
  if (!result) throw new Error('Cashier command completion was not saved')
  return result
}

export function recordCompletedCashierCommand(
  database: DatabaseSync,
  context: StoreContext,
  input: {
    commandId: string
    requestedByEmployeeId: string
    order: SalesOrderSummary
  }
): CashierCommandExecutionRecord {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = recordCompletedCashierCommandInOpenTransaction(
      database,
      context,
      input
    )
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function recordFailedCashierCommand(
  database: DatabaseSync,
  context: StoreContext,
  input: {
    commandId: string
    requestedByEmployeeId: string
    errorMessage: string
  }
): CashierCommandExecutionRecord {
  const errorMessage = input.errorMessage.trim()
  if (errorMessage.length < 1 || errorMessage.length > 500) {
    throw new RangeError('Cashier command failure must contain 1-500 characters')
  }
  const existing = findCashierCommandExecution(
    database,
    context,
    input.commandId
  )
  if (existing) return existing
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT INTO cashier_command_execution
         (command_id, tenant_id, store_id, device_id,
          requested_by_employee_id, status, local_order_id, result_json,
          error_message, reported_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'failed', NULL, NULL, ?, NULL, ?, ?)`
      )
      .run(
        input.commandId,
        context.tenantId,
        context.storeId,
        context.deviceId,
        input.requestedByEmployeeId,
        errorMessage,
        timestamp,
        timestamp
      )
    const result = findCashierCommandExecution(
      database,
      context,
      input.commandId
    )
    if (!result) throw new Error('Cashier command failure was not saved')
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function markCashierCommandReported(
  database: DatabaseSync,
  context: StoreContext,
  commandId: string
): void {
  const timestamp = new Date().toISOString()
  const result = database
    .prepare(
      `UPDATE cashier_command_execution
       SET reported_at = COALESCE(reported_at, ?), updated_at = ?
       WHERE command_id = ? AND tenant_id = ? AND store_id = ?`
    )
    .run(
      timestamp,
      timestamp,
      commandId,
      context.tenantId,
      context.storeId
    )
  if (result.changes !== 1) {
    throw new Error('Cashier command execution was not found')
  }
}
