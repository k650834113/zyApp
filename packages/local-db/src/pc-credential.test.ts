import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  findPcOfflineCredential,
  getStoreContext,
  invalidatePcOfflineCredential,
  openLocalDatabase,
  queuePcCredentialMigrations,
  savePcOfflineCredential
} from './index'

const directories: string[] = []

afterEach(() => {
  directories.splice(0).forEach((directory) => {
    rmSync(directory, { recursive: true, force: true })
  })
})

describe('desktop PC credential cache', () => {
  it('binds an offline verifier to employee, store and device and can invalidate it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-pc-credential-'))
    directories.push(directory)
    const database = openLocalDatabase(join(directory, 'local.db'))
    const bootstrapped = bootstrapStore(database.connection, {
      storeName: 'Credential Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$server-side',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier'
    })
    const context = getStoreContext(database.connection)
    if (!context) throw new Error('Missing context')
    savePcOfflineCredential(
      database.connection,
      context,
      {
        employee: {
          id: bootstrapped.managerId,
          username: 'manager',
          displayName: 'Manager',
          role: 'manager',
          status: 'active'
        },
        tenantId: context.tenantId,
        storeId: context.storeId,
        deviceId: context.deviceId,
        credentialVersion: 2,
        authorizationVersion: 8,
        serverTime: '2026-07-01T00:00:00.000Z',
        offlineValidUntil: '2026-07-31T00:00:00.000Z'
      },
      'encrypted-local-verifier'
    )
    expect(findPcOfflineCredential(database.connection, context, 'MANAGER')).toMatchObject({
      employeeId: bootstrapped.managerId,
      encryptedVerifier: 'encrypted-local-verifier',
      credentialVersion: 2,
      authorizationVersion: 8,
      invalidatedAt: null
    })
    invalidatePcOfflineCredential(
      database.connection,
      bootstrapped.managerId,
      '2026-07-02T00:00:00.000Z'
    )
    expect(findPcOfflineCredential(database.connection, context, 'manager')?.invalidatedAt)
      .toBe('2026-07-02T00:00:00.000Z')
    database.close()
  })

  it('queues each existing scrypt credential once without adding it to audit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-pc-migration-'))
    directories.push(directory)
    const database = openLocalDatabase(join(directory, 'local.db'))
    const bootstrapped = bootstrapStore(database.connection, {
      storeName: 'Credential Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$existing-secret',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier'
    })
    const context = getStoreContext(database.connection)
    if (!context) throw new Error('Missing context')
    expect(queuePcCredentialMigrations(
      database.connection,
      context,
      bootstrapped.managerId
    )).toBe(1)
    expect(queuePcCredentialMigrations(
      database.connection,
      context,
      bootstrapped.managerId
    )).toBe(0)
    const operation = database.connection.prepare(
      `SELECT payload_json FROM outbox_operation
       WHERE operation_type = 'employee.pc_credential.updated'`
    ).get() as { payload_json: string }
    expect(operation.payload_json).toContain('scrypt$existing-secret')
    expect(JSON.stringify(database.connection.prepare(
      'SELECT before_json, after_json FROM audit_log'
    ).all())).not.toContain('scrypt$existing-secret')
    database.close()
  })
})
