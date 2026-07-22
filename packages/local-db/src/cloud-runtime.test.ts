import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertCloudMirrorSafeForFinancialWrite,
  bootstrapStore,
  cacheOfflineFinancialLease,
  cacheCloudMirrorPage,
  enrichCloudSyncOperation,
  ensureCloudRuntimeState,
  getCloudRuntimeState,
  getStoreContext,
  openLocalDatabase,
  recordCloudMirrorRepair,
  recordPendingCloudOutcome,
  resolveCloudOutcome,
  setCloudRuntimeMode
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

describe('cloud primary local runtime state', () => {
  it('tracks reachability, ambiguous outcomes and mirror repair blocks', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-cloud-runtime-'))
    temporaryDirectories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    try {
      bootstrapStore(local.connection, {
        storeName: 'Runtime Store',
        managerUsername: 'manager',
        managerPasswordHash: 'scrypt$test',
        managerDisplayName: 'Manager',
        deviceName: 'Cashier'
      })
      const context = getStoreContext(local.connection)
      if (!context) throw new Error('Missing store context')

      const initial = ensureCloudRuntimeState(local.connection, context)
      expect(initial.runtimeMode).toBe('not_configured')
      expect(initial.mirrorEpoch).toMatch(/^[0-9a-f-]{36}$/)

      setCloudRuntimeMode(local.connection, context, 'cloud_online', {
        reachable: true,
        now: '2026-06-30T08:00:00.000Z'
      })
      recordPendingCloudOutcome(local.connection, context, {
        operationId: 'operation-1',
        aggregateType: 'wallet',
        aggregateId: 'member-1',
        now: '2026-06-30T08:00:01.000Z'
      })
      expect(getCloudRuntimeState(local.connection, context)).toMatchObject({
        runtimeMode: 'cloud_online',
        lastCloudReachableAt: '2026-06-30T08:00:00.000Z',
        pendingOutcomes: 1,
        mirrorRepairRequired: false
      })

      setCloudRuntimeMode(local.connection, context, 'local_offline')
      expect(() =>
        assertCloudMirrorSafeForFinancialWrite(
          local.connection,
          context,
          'wallet'
        )
      ).toThrow('离线财务主收银租约')
      cacheOfflineFinancialLease(local.connection, context, {
        ownerDeviceId: context.deviceId,
        expiresAt: '2099-06-30T08:00:00.000Z',
        leaseVersion: 1
      })
      expect(() =>
        assertCloudMirrorSafeForFinancialWrite(
          local.connection,
          context,
          'wallet'
        )
      ).not.toThrow()
      setCloudRuntimeMode(local.connection, context, 'cloud_online')

      cacheCloudMirrorPage(local.connection, context, {
        resource: 'members',
        rows: [
          {
            id: 'member-1',
            payload: { id: 'member-1', server_version: 17 }
          }
        ],
        nextCursor: null,
        eventCursor: '17',
        serverTime: '2026-06-30T08:00:00.000Z'
      })
      expect(
        enrichCloudSyncOperation(local.connection, context, {
          operationId: 'operation-v2',
          deviceId: context.deviceId,
          deviceSeq: 99,
          tenantId: context.tenantId,
          storeId: context.storeId,
          actorId: null,
          operationType: 'member.updated',
          aggregateId: 'member-1',
          baseVersion: null,
          occurredAt: '2026-06-30T08:00:00.000Z',
          payloadJson: JSON.stringify({
            before: { nickname: 'Old', note: 'Same' },
            after: { nickname: 'New', note: 'Same' }
          }),
          payloadHash: 'a'.repeat(64)
        })
      ).toMatchObject({
        protocolVersion: 2,
        baseVersion: 17,
        changedFields: ['nickname']
      })

      resolveCloudOutcome(local.connection, {
        operationId: 'operation-1',
        status: 'confirmed',
        serverVersion: 42
      })
      recordCloudMirrorRepair(local.connection, context, {
        operationId: 'operation-1',
        aggregateType: 'wallet',
        aggregateId: 'member-1',
        errorMessage: 'disk full'
      })
      expect(() =>
        assertCloudMirrorSafeForFinancialWrite(
          local.connection,
          context,
          'wallet',
          'member-1'
        )
      ).toThrow('本地镜像尚未修复')
      expect(getCloudRuntimeState(local.connection, context)).toMatchObject({
        pendingOutcomes: 0,
        mirrorRepairRequired: true
      })
    } finally {
      local.close()
    }
  })
})
