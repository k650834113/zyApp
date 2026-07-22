import type { DatabaseSync } from 'node:sqlite'
import type {
  EmployeeFinancialCommandResult,
  EmployeeFinancialCommandType
} from '@zyapp/contracts'
import type { StoreContext } from './identity'

export type EmployeeFinancialCommandExecutionRecord =
  | {
      commandId: string
      requestedByEmployeeId: string
      commandType: EmployeeFinancialCommandType
      status: 'completed'
      result: EmployeeFinancialCommandResult
      errorMessage: null
      reportedAt: string | null
      createdAt: string
      updatedAt: string
    }
  | {
      commandId: string
      requestedByEmployeeId: string
      commandType: EmployeeFinancialCommandType
      status: 'failed'
      result: null
      errorMessage: string
      reportedAt: string | null
      createdAt: string
      updatedAt: string
    }

type ExecutionRow = {
  command_id: string
  requested_by_employee_id: string
  command_type: EmployeeFinancialCommandType
  status: 'completed' | 'failed'
  result_json: string | null
  error_message: string | null
  reported_at: string | null
  created_at: string
  updated_at: string
}

function mapExecution(
  row: ExecutionRow
): EmployeeFinancialCommandExecutionRecord {
  const shared = {
    commandId: row.command_id,
    requestedByEmployeeId: row.requested_by_employee_id,
    commandType: row.command_type,
    reportedAt: row.reported_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  if (row.status === 'completed') {
    if (!row.result_json) {
      throw new Error('Completed employee financial command is incomplete')
    }
    return {
      ...shared,
      status: 'completed',
      result: JSON.parse(row.result_json) as EmployeeFinancialCommandResult,
      errorMessage: null
    }
  }
  if (!row.error_message) {
    throw new Error('Failed employee financial command is incomplete')
  }
  return {
    ...shared,
    status: 'failed',
    result: null,
    errorMessage: row.error_message
  }
}

export function findEmployeeFinancialCommandExecution(
  database: DatabaseSync,
  context: StoreContext,
  commandId: string
): EmployeeFinancialCommandExecutionRecord | null {
  const row = database
    .prepare(
      `SELECT command_id, requested_by_employee_id, command_type, status,
              result_json, error_message, reported_at, created_at, updated_at
       FROM employee_financial_command_execution
       WHERE command_id = ? AND tenant_id = ? AND store_id = ?`
    )
    .get(commandId, context.tenantId, context.storeId) as
    | ExecutionRow
    | undefined
  return row ? mapExecution(row) : null
}

export function listPendingEmployeeFinancialCommandReports(
  database: DatabaseSync,
  context: StoreContext,
  limit = 20
): EmployeeFinancialCommandExecutionRecord[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('Financial command report limit must be 1-100')
  }
  const rows = database
    .prepare(
      `SELECT command_id, requested_by_employee_id, command_type, status,
              result_json, error_message, reported_at, created_at, updated_at
       FROM employee_financial_command_execution
       WHERE tenant_id = ? AND store_id = ? AND reported_at IS NULL
       ORDER BY created_at, command_id
       LIMIT ?`
    )
    .all(context.tenantId, context.storeId, limit) as ExecutionRow[]
  return rows.map(mapExecution)
}

export function recordCompletedEmployeeFinancialCommandInOpenTransaction(
  database: DatabaseSync,
  context: StoreContext,
  input: {
    commandId: string
    requestedByEmployeeId: string
    commandType: EmployeeFinancialCommandType
    result: EmployeeFinancialCommandResult
    timestamp?: string
  }
): EmployeeFinancialCommandExecutionRecord {
  if (input.result.type !== input.commandType) {
    throw new Error('Financial command result type does not match command')
  }
  const timestamp = input.timestamp ?? new Date().toISOString()
  const existing = findEmployeeFinancialCommandExecution(
    database,
    context,
    input.commandId
  )
  if (existing) {
    if (
      existing.status !== 'completed' ||
      existing.commandType !== input.commandType
    ) {
      throw new Error('Financial command already has a different result')
    }
    return existing
  }
  database
    .prepare(
      `INSERT INTO employee_financial_command_execution
       (command_id, tenant_id, store_id, device_id,
        requested_by_employee_id, command_type, status, result_json,
        error_message, reported_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, NULL, NULL, ?, ?)`
    )
    .run(
      input.commandId,
      context.tenantId,
      context.storeId,
      context.deviceId,
      input.requestedByEmployeeId,
      input.commandType,
      JSON.stringify(input.result),
      timestamp,
      timestamp
    )
  const result = findEmployeeFinancialCommandExecution(
    database,
    context,
    input.commandId
  )
  if (!result) throw new Error('Financial command completion was not saved')
  return result
}

export function recordCompletedEmployeeFinancialCommand(
  database: DatabaseSync,
  context: StoreContext,
  input: {
    commandId: string
    requestedByEmployeeId: string
    commandType: EmployeeFinancialCommandType
    result: EmployeeFinancialCommandResult
  }
): EmployeeFinancialCommandExecutionRecord {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result =
      recordCompletedEmployeeFinancialCommandInOpenTransaction(
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

export function recordFailedEmployeeFinancialCommand(
  database: DatabaseSync,
  context: StoreContext,
  input: {
    commandId: string
    requestedByEmployeeId: string
    commandType: EmployeeFinancialCommandType
    errorMessage: string
  }
): EmployeeFinancialCommandExecutionRecord {
  const errorMessage = input.errorMessage.trim()
  if (errorMessage.length < 1 || errorMessage.length > 500) {
    throw new RangeError('Financial command failure must contain 1-500 characters')
  }
  const existing = findEmployeeFinancialCommandExecution(
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
        `INSERT INTO employee_financial_command_execution
         (command_id, tenant_id, store_id, device_id,
          requested_by_employee_id, command_type, status, result_json,
          error_message, reported_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'failed', NULL, ?, NULL, ?, ?)`
      )
      .run(
        input.commandId,
        context.tenantId,
        context.storeId,
        context.deviceId,
        input.requestedByEmployeeId,
        input.commandType,
        errorMessage,
        timestamp,
        timestamp
      )
    const result = findEmployeeFinancialCommandExecution(
      database,
      context,
      input.commandId
    )
    if (!result) throw new Error('Financial command failure was not saved')
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function markEmployeeFinancialCommandReported(
  database: DatabaseSync,
  context: StoreContext,
  commandId: string
): void {
  const timestamp = new Date().toISOString()
  const result = database
    .prepare(
      `UPDATE employee_financial_command_execution
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
    throw new Error('Financial command execution was not found')
  }
}
