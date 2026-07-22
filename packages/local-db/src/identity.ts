import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type StoredEmployee = {
  id: string
  tenantId: string
  storeId: string
  username: string
  passwordHash: string
  displayName: string
  role: 'manager' | 'staff'
  status: 'active' | 'disabled'
  mobileAccessEnabled: boolean
  createdAt: string
  updatedAt: string
}

export type EmployeeRecord = Omit<StoredEmployee, 'tenantId' | 'storeId' | 'passwordHash'>

export type StoreContext = {
  tenantId: string
  storeId: string
  storeName: string
  deviceId: string
}

type WriteContext = StoreContext & {
  actorId: string
}

function mapEmployee(row: Record<string, unknown>): StoredEmployee {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    storeId: String(row.store_id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    displayName: String(row.display_name),
    role: row.role === 'manager' ? 'manager' : 'staff',
    status: row.status === 'active' ? 'active' : 'disabled',
    mobileAccessEnabled: Number(row.mobile_access_enabled) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function toPublicEmployee(employee: StoredEmployee): EmployeeRecord {
  const { tenantId: _tenantId, storeId: _storeId, passwordHash: _passwordHash, ...record } =
    employee
  return record
}

export function getStoreContext(database: DatabaseSync): StoreContext | null {
  const row = database
    .prepare(
      `SELECT s.tenant_id, s.id AS store_id, s.name AS store_name, d.id AS device_id
       FROM store s
       JOIN device d ON d.store_id = s.id
       ORDER BY d.created_at
       LIMIT 1`
    )
    .get() as Record<string, unknown> | undefined

  if (!row) {
    return null
  }

  return {
    tenantId: String(row.tenant_id),
    storeId: String(row.store_id),
    storeName: String(row.store_name),
    deviceId: String(row.device_id)
  }
}

export function findEmployeeByUsername(
  database: DatabaseSync,
  username: string
): StoredEmployee | null {
  const context = getStoreContext(database)
  if (!context) {
    return null
  }

  const row = database
    .prepare(
      `SELECT e.id, e.tenant_id, e.store_id, e.username, e.password_hash,
              e.display_name, e.role, e.status, e.created_at, e.updated_at,
              COALESCE(c.enabled, 0) mobile_access_enabled
       FROM employee e
       LEFT JOIN employee_mobile_credential c ON c.employee_id = e.id
       WHERE e.tenant_id = ? AND e.username = ?
       LIMIT 1`
    )
    .get(context.tenantId, username.trim().toLowerCase()) as Record<string, unknown> | undefined

  return row ? mapEmployee(row) : null
}

export function findEmployeeRecordById(
  database: DatabaseSync,
  tenantId: string,
  employeeId: string
): EmployeeRecord | null {
  const row = database
    .prepare(
      `SELECT e.id, e.tenant_id, e.store_id, e.username, e.password_hash,
              e.display_name, e.role, e.status, e.created_at, e.updated_at,
              COALESCE(c.enabled, 0) mobile_access_enabled
       FROM employee e
       LEFT JOIN employee_mobile_credential c ON c.employee_id = e.id
       WHERE e.tenant_id = ? AND e.id = ?
       LIMIT 1`
    )
    .get(tenantId, employeeId) as Record<string, unknown> | undefined

  return row ? toPublicEmployee(mapEmployee(row)) : null
}

export function listEmployees(database: DatabaseSync): EmployeeRecord[] {
  const context = getStoreContext(database)
  if (!context) {
    return []
  }

  const rows = database
    .prepare(
      `SELECT e.id, e.tenant_id, e.store_id, e.username, e.password_hash,
              e.display_name, e.role, e.status, e.created_at, e.updated_at,
              COALESCE(c.enabled, 0) mobile_access_enabled
       FROM employee e
       LEFT JOIN employee_mobile_credential c ON c.employee_id = e.id
       WHERE e.tenant_id = ?
       ORDER BY CASE e.role WHEN 'manager' THEN 0 ELSE 1 END, e.created_at`
    )
    .all(context.tenantId) as Record<string, unknown>[]

  return rows.map(mapEmployee).map(toPublicEmployee)
}

function nextDeviceSequence(database: DatabaseSync, deviceId: string): number {
  const row = database.prepare('SELECT next_sequence FROM device WHERE id = ?').get(deviceId) as
    | { next_sequence: number }
    | undefined
  if (!row) {
    throw new Error('Registered device is missing')
  }

  database
    .prepare('UPDATE device SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), deviceId)

  return row.next_sequence
}

function appendAuditAndOutbox(
  database: DatabaseSync,
  context: WriteContext,
  input: {
    action: string
    operationType: string
    aggregateId: string
    reason: string
    before: unknown
    after: unknown
    outboxAfter?: unknown
  }
): void {
  const timestamp = new Date().toISOString()
  const payload = JSON.stringify({
    action: input.action,
    aggregateId: input.aggregateId,
    before: input.before,
    after: input.outboxAfter ?? input.after,
    reason: input.reason
  })
  const payloadHash = createHash('sha256').update(payload).digest('hex')
  const sequence = nextDeviceSequence(database, context.deviceId)

  database
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 'employee', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actorId,
      input.action,
      input.aggregateId,
      input.reason,
      input.before === null ? null : JSON.stringify(input.before),
      input.after === null ? null : JSON.stringify(input.after),
      timestamp
    )
  database
    .prepare(
      `INSERT INTO outbox_operation
       (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
        operation_type, aggregate_id, base_version, occurred_at, payload_json, payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.deviceId,
      sequence,
      context.tenantId,
      context.storeId,
      context.actorId,
      input.operationType,
      input.aggregateId,
      timestamp,
      payload,
      payloadHash
    )
}

function appendPcCredentialOutbox(
  database: DatabaseSync,
  context: WriteContext,
  employeeId: string,
  passwordHash: string,
  updatedAt: string
): void {
  const operationId = randomUUID()
  const payload = JSON.stringify({
    action: 'employee.pc_credential.updated',
    aggregateId: employeeId,
    before: null,
    after: { employeeId, passwordHash, updatedAt },
    reason: 'desktop credential changed'
  })
  const payloadHash = createHash('sha256').update(payload).digest('hex')
  const sequence = nextDeviceSequence(database, context.deviceId)
  database.prepare(
    `INSERT INTO outbox_operation
     (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
      operation_type, aggregate_id, base_version, occurred_at, payload_json,
      payload_hash)
     VALUES (?, ?, ?, ?, ?, ?, 'employee.pc_credential.updated', ?, NULL,
             ?, ?, ?)`
  ).run(
    operationId,
    context.deviceId,
    sequence,
    context.tenantId,
    context.storeId,
    context.actorId,
    employeeId,
    updatedAt,
    payload,
    payloadHash
  )
  database.prepare(
    `INSERT INTO employee_pc_credential_migration
     (employee_id, tenant_id, store_id, operation_id, queued_at, confirmed_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT (employee_id) DO UPDATE SET
       operation_id = excluded.operation_id,
       queued_at = excluded.queued_at,
       confirmed_at = NULL`
  ).run(
    employeeId,
    context.tenantId,
    context.storeId,
    operationId,
    updatedAt
  )
}

export function recordLoginAttempt(
  database: DatabaseSync,
  employee: StoredEmployee | null,
  username: string,
  success: boolean
): void {
  const context = getStoreContext(database)
  if (!context) {
    return
  }

  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    if (success && employee) {
      database
        .prepare('UPDATE employee SET last_login_at = ?, updated_at = ? WHERE id = ?')
        .run(timestamp, timestamp, employee.id)
    }
    database
      .prepare(
        `INSERT INTO audit_log
         (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
          aggregate_id, reason, before_json, after_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, 'employee', ?, ?, NULL, NULL, ?)`
      )
      .run(
        randomUUID(),
        context.tenantId,
        context.storeId,
        context.deviceId,
        employee?.id ?? null,
        success ? 'employee.login.succeeded' : 'employee.login.failed',
        employee?.id ?? username,
        success ? 'password verified' : 'invalid credentials or disabled account',
        timestamp
      )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function createEmployee(
  database: DatabaseSync,
  context: WriteContext,
  input: {
    username: string
    passwordHash: string
    displayName: string
    role: 'manager' | 'staff'
  }
): EmployeeRecord {
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  const username = input.username.trim().toLowerCase()

  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT INTO employee
         (id, tenant_id, store_id, username, password_hash, display_name, role,
          status, created_at, updated_at, password_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
      )
      .run(
        id,
        context.tenantId,
        context.storeId,
        username,
        input.passwordHash,
        input.displayName,
        input.role,
        timestamp,
        timestamp,
        timestamp
      )
    appendAuditAndOutbox(database, context, {
      action: 'employee.created',
      operationType: 'employee.created',
      aggregateId: id,
      reason: 'manager created employee',
      before: null,
      after: { username, displayName: input.displayName, role: input.role, status: 'active' }
    })
    appendPcCredentialOutbox(database, context, id, input.passwordHash, timestamp)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }

  return {
    id,
    username,
    displayName: input.displayName,
    role: input.role,
    status: 'active',
    mobileAccessEnabled: false,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function setEmployeeStatus(
  database: DatabaseSync,
  context: WriteContext,
  input: {
    employeeId: string
    status: 'active' | 'disabled'
    reason: string
  }
): EmployeeRecord {
  if (input.employeeId === context.actorId && input.status === 'disabled') {
    throw new Error('You cannot disable the account currently in use')
  }

  const row = database
    .prepare(
      `SELECT e.id, e.tenant_id, e.store_id, e.username, e.password_hash,
              e.display_name, e.role, e.status, e.created_at, e.updated_at,
              COALESCE(c.enabled, 0) mobile_access_enabled
       FROM employee e
       LEFT JOIN employee_mobile_credential c ON c.employee_id = e.id
       WHERE e.id = ? AND e.tenant_id = ?`
    )
    .get(input.employeeId, context.tenantId) as Record<string, unknown> | undefined
  if (!row) {
    throw new Error('Employee was not found')
  }
  const current = mapEmployee(row)
  if (current.status === input.status) {
    return toPublicEmployee(current)
  }

  if (current.role === 'manager' && input.status === 'disabled') {
    const activeManagers = database
      .prepare(
        `SELECT COUNT(*) AS count FROM employee
         WHERE tenant_id = ? AND role = 'manager' AND status = 'active'`
      )
      .get(context.tenantId) as { count: number }
    if (activeManagers.count <= 1) {
      throw new Error('At least one active manager account must remain')
    }
  }

  const timestamp = new Date().toISOString()
  const next = { ...toPublicEmployee(current), status: input.status, updatedAt: timestamp }

  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `UPDATE employee
         SET status = ?, disabled_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .run(
        input.status,
        input.status === 'disabled' ? timestamp : null,
        timestamp,
        input.employeeId,
        context.tenantId
      )
    appendAuditAndOutbox(database, context, {
      action: input.status === 'disabled' ? 'employee.disabled' : 'employee.enabled',
      operationType:
        input.status === 'disabled' ? 'employee.disabled' : 'employee.enabled',
      aggregateId: input.employeeId,
      reason: input.reason,
      before: toPublicEmployee(current),
      after: next
    })
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }

  return next
}

export function resetEmployeePassword(
  database: DatabaseSync,
  context: WriteContext,
  input: {
    employeeId: string
    passwordHash: string
    reason: string
  }
): void {
  const employee = database
    .prepare('SELECT id FROM employee WHERE id = ? AND tenant_id = ?')
    .get(input.employeeId, context.tenantId)
  if (!employee) {
    throw new Error('Employee was not found')
  }

  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `UPDATE employee
         SET password_hash = ?, password_changed_at = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .run(input.passwordHash, timestamp, timestamp, input.employeeId, context.tenantId)
    appendAuditAndOutbox(database, context, {
      action: 'employee.password.reset',
      operationType: 'employee.password.changed',
      aggregateId: input.employeeId,
      reason: input.reason,
      before: { passwordChanged: false },
      after: { passwordChanged: true }
    })
    appendPcCredentialOutbox(
      database,
      context,
      input.employeeId,
      input.passwordHash,
      timestamp
    )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function configureEmployeeMobileAccess(
  database: DatabaseSync,
  context: WriteContext,
  input: {
    employeeId: string
    enabled: boolean
    passwordHash?: string
    reason: string
  }
): EmployeeRecord {
  const current = findEmployeeRecordById(
    database,
    context.tenantId,
    input.employeeId
  )
  if (!current) throw new Error('Employee was not found')
  if (current.status !== 'active' && input.enabled) {
    throw new Error('Disabled employees cannot enable mobile access')
  }
  if (input.enabled && !input.passwordHash) {
    throw new Error('Mobile password hash is required')
  }

  const timestamp = new Date().toISOString()
  const next: EmployeeRecord = {
    ...current,
    mobileAccessEnabled: input.enabled,
    updatedAt: timestamp
  }
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT INTO employee_mobile_credential
         (employee_id, tenant_id, store_id, enabled, password_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (employee_id) DO UPDATE SET
           enabled = excluded.enabled,
           password_hash = excluded.password_hash,
           updated_at = excluded.updated_at`
      )
      .run(
        input.employeeId,
        context.tenantId,
        context.storeId,
        input.enabled ? 1 : 0,
        input.enabled ? (input.passwordHash ?? null) : null,
        timestamp
      )
    database
      .prepare(
        `UPDATE employee SET updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .run(timestamp, input.employeeId, context.tenantId)
    appendAuditAndOutbox(database, context, {
      action: input.enabled
        ? 'employee.mobile_access.enabled'
        : 'employee.mobile_access.disabled',
      operationType: 'employee.mobile_access.updated',
      aggregateId: input.employeeId,
      reason: input.reason,
      before: { mobileAccessEnabled: current.mobileAccessEnabled },
      after: { mobileAccessEnabled: input.enabled, updatedAt: timestamp },
      outboxAfter: {
        employeeId: input.employeeId,
        enabled: input.enabled,
        passwordHash: input.enabled ? input.passwordHash : null,
        updatedAt: timestamp
      }
    })
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  return next
}
