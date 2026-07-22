import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { DesktopCloudLoginResult } from '@zyapp/contracts'
import type { StoreContext } from './identity'

export type PcOfflineCredentialRecord = {
  employeeId: string
  username: string
  displayName: string
  role: 'manager' | 'staff'
  status: 'active' | 'disabled'
  encryptedVerifier: string
  credentialVersion: number
  authorizationVersion: number
  verifiedAt: string
  expiresAt: string
  invalidatedAt: string | null
}

export function findPcOfflineCredential(
  database: DatabaseSync,
  context: StoreContext,
  username: string
): PcOfflineCredentialRecord | null {
  const row = database.prepare(
    `SELECT e.id employee_id, e.username, e.display_name, e.role, e.status,
            c.encrypted_verifier, c.credential_version,
            c.authorization_version, c.verified_at, c.expires_at,
            c.invalidated_at
     FROM employee e
     JOIN employee_pc_offline_credential c ON c.employee_id = e.id
     WHERE e.tenant_id = ? AND e.store_id = ? AND c.device_id = ?
       AND e.username = ?
     LIMIT 1`
  ).get(
    context.tenantId,
    context.storeId,
    context.deviceId,
    username.trim().toLowerCase()
  ) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    employeeId: String(row.employee_id),
    username: String(row.username),
    displayName: String(row.display_name),
    role: row.role === 'manager' ? 'manager' : 'staff',
    status: row.status === 'active' ? 'active' : 'disabled',
    encryptedVerifier: String(row.encrypted_verifier),
    credentialVersion: Number(row.credential_version),
    authorizationVersion: Number(row.authorization_version),
    verifiedAt: String(row.verified_at),
    expiresAt: String(row.expires_at),
    invalidatedAt: row.invalidated_at ? String(row.invalidated_at) : null
  }
}

export function savePcOfflineCredential(
  database: DatabaseSync,
  context: StoreContext,
  result: DesktopCloudLoginResult,
  encryptedVerifier: string
): void {
  if (
    result.tenantId !== context.tenantId ||
    result.storeId !== context.storeId ||
    result.deviceId !== context.deviceId
  ) {
    throw new Error('Cloud login identity does not match the active device')
  }
  const timestamp = result.serverTime
  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare(
      `INSERT INTO employee
       (id, tenant_id, store_id, username, password_hash, display_name, role,
        status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'cloud-login-not-configured', ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         username = excluded.username,
         display_name = excluded.display_name,
         role = excluded.role,
         status = excluded.status,
         updated_at = excluded.updated_at
       WHERE employee.tenant_id = excluded.tenant_id
         AND employee.store_id = excluded.store_id`
    ).run(
      result.employee.id,
      result.tenantId,
      result.storeId,
      result.employee.username,
      result.employee.displayName,
      result.employee.role,
      result.employee.status,
      timestamp,
      timestamp
    )
    database.prepare(
      `INSERT INTO employee_pc_offline_credential
       (employee_id, tenant_id, store_id, device_id, encrypted_verifier,
        credential_version, authorization_version, verified_at, expires_at,
        invalidated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT (employee_id) DO UPDATE SET
         tenant_id = excluded.tenant_id,
         store_id = excluded.store_id,
         device_id = excluded.device_id,
         encrypted_verifier = excluded.encrypted_verifier,
         credential_version = excluded.credential_version,
         authorization_version = excluded.authorization_version,
         verified_at = excluded.verified_at,
         expires_at = excluded.expires_at,
         invalidated_at = NULL,
         updated_at = excluded.updated_at`
    ).run(
      result.employee.id,
      result.tenantId,
      result.storeId,
      result.deviceId,
      encryptedVerifier,
      result.credentialVersion,
      result.authorizationVersion,
      result.serverTime,
      result.offlineValidUntil,
      timestamp
    )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function invalidatePcOfflineCredential(
  database: DatabaseSync,
  employeeId: string,
  timestamp = new Date().toISOString()
): void {
  database.prepare(
    `UPDATE employee_pc_offline_credential
     SET invalidated_at = COALESCE(invalidated_at, ?), updated_at = ?
     WHERE employee_id = ?`
  ).run(timestamp, timestamp, employeeId)
}

export function queuePcCredentialMigrations(
  database: DatabaseSync,
  context: StoreContext,
  actorId: string
): number {
  const rows = database.prepare(
    `SELECT e.id, e.password_hash, e.updated_at
     FROM employee e
     LEFT JOIN employee_pc_credential_migration m ON m.employee_id = e.id
     WHERE e.tenant_id = ? AND e.store_id = ? AND m.employee_id IS NULL
       AND e.password_hash LIKE 'scrypt$%'
     ORDER BY e.created_at, e.id`
  ).all(context.tenantId, context.storeId) as Array<{
    id: string
    password_hash: string
    updated_at: string
  }>
  if (rows.length === 0) return 0

  database.exec('BEGIN IMMEDIATE')
  try {
    const sequenceRow = database.prepare(
      'SELECT next_sequence FROM device WHERE id = ?'
    ).get(context.deviceId) as { next_sequence: number } | undefined
    if (!sequenceRow) throw new Error('Registered device is missing')
    let sequence = sequenceRow.next_sequence
    const insertOutbox = database.prepare(
      `INSERT INTO outbox_operation
       (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
        operation_type, aggregate_id, base_version, occurred_at, payload_json,
        payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, 'employee.pc_credential.updated', ?, NULL,
               ?, ?, ?)`
    )
    const insertMigration = database.prepare(
      `INSERT INTO employee_pc_credential_migration
       (employee_id, tenant_id, store_id, operation_id, queued_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const row of rows) {
      const operationId = randomUUID()
      const occurredAt = new Date().toISOString()
      const payload = JSON.stringify({
        action: 'employee.pc_credential.updated',
        aggregateId: row.id,
        before: null,
        after: {
          employeeId: row.id,
          passwordHash: row.password_hash,
          updatedAt: row.updated_at
        },
        reason: 'existing desktop credential migration'
      })
      insertOutbox.run(
        operationId,
        context.deviceId,
        sequence,
        context.tenantId,
        context.storeId,
        actorId,
        row.id,
        occurredAt,
        payload,
        createHash('sha256').update(payload).digest('hex')
      )
      insertMigration.run(
        row.id,
        context.tenantId,
        context.storeId,
        operationId,
        occurredAt
      )
      sequence += 1
    }
    database.prepare(
      'UPDATE device SET next_sequence = ?, updated_at = ? WHERE id = ?'
    ).run(sequence, new Date().toISOString(), context.deviceId)
    database.exec('COMMIT')
    return rows.length
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
