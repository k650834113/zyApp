import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applySyncPullResult,
  applySyncPushResult,
  bootstrapStore,
  createMember,
  findEmployeeRecordById,
  getLocalSyncStatus,
  getStoreContext,
  listPendingSyncBatch,
  openLocalDatabase,
  recordSyncBatchAccepted
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

describe('local sync outbox', () => {
  it('builds pending batches and records confirmations and conflicts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-sync-'))
    temporaryDirectories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    const bootstrap = bootstrapStore(local.connection, {
      storeName: 'Sync Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier'
    })
    const context = getStoreContext(local.connection)
    if (!context) throw new Error('Missing store')
    const actor = findEmployeeRecordById(
      local.connection,
      context.tenantId,
      bootstrap.managerId
    )
    if (!actor) throw new Error('Missing manager')
    createMember(
      local.connection,
      { ...context, actor },
      {
        phone: '13800138000',
        nickname: '同步会员',
        confirmedAtLeast14: true
      }
    )

    const batch = listPendingSyncBatch(local.connection, context)
    expect(batch?.operations).toHaveLength(2)
    const first = batch?.operations[0]
    const second = batch?.operations[1]
    if (!first || !second) throw new Error('Missing operations')
    expect(getLocalSyncStatus(local.connection, context)).toMatchObject({
      pendingOperations: 2,
      conflictedOperations: 0,
      lastConfirmedDeviceSeq: 0
    })
    recordSyncBatchAccepted(
      local.connection,
      context,
      '2026-06-12T00:00:00.000Z'
    )
    expect(getLocalSyncStatus(local.connection, context).lastPushAt).toBe(
      '2026-06-12T00:00:00.000Z'
    )

    const applied = applySyncPushResult(local.connection, context, {
      protocolVersion: 1,
      deviceId: context.deviceId,
      serverTime: '2026-06-12T00:00:00.000Z',
      receipts: [
        {
          operationId: first.operationId,
          status: 'confirmed',
          serverVersion: 1
        },
        {
          operationId: second.operationId,
          status: 'conflict',
          conflictType: 'member_phone_duplicate',
          serverPayloadJson: '{"memberId":"cloud-member"}'
        }
      ]
    })
    expect(applied).toEqual({
      confirmed: 1,
      conflicts: 1,
      lastConfirmedDeviceSeq: 1
    })
    expect(getLocalSyncStatus(local.connection, context).lastPullAt).toBeNull()
    expect(
      local.connection
        .prepare(
          `SELECT sync_status FROM outbox_operation
           WHERE operation_id = ?`
        )
        .get(second.operationId)
    ).toEqual({ sync_status: 'conflict' })
    expect(
      local.connection
        .prepare(
          `SELECT conflict_type, status FROM sync_conflict
           WHERE operation_id = ?`
        )
        .get(second.operationId)
    ).toEqual({
      conflict_type: 'member_phone_duplicate',
      status: 'pending'
    })

    const resolved = applySyncPushResult(local.connection, context, {
      protocolVersion: 1,
      deviceId: context.deviceId,
      serverTime: '2026-06-12T00:01:00.000Z',
      receipts: [
        {
          operationId: second.operationId,
          status: 'confirmed',
          serverVersion: 2
        }
      ]
    })
    expect(resolved.lastConfirmedDeviceSeq).toBe(2)
    expect(
      local.connection
        .prepare(
          `SELECT status FROM sync_conflict WHERE operation_id = ?`
        )
        .get(second.operationId)
    ).toEqual({ status: 'resolved' })
    expect(listPendingSyncBatch(local.connection, context)).toBeNull()

    local.close()
  })

  it('stores cloud events atomically and advances a durable pull cursor', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-pull-'))
    temporaryDirectories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    bootstrapStore(local.connection, {
      storeName: 'Pull Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier'
    })
    const context = getStoreContext(local.connection)
    if (!context) throw new Error('Missing store')

    const applied = applySyncPullResult(local.connection, context, {
      protocolVersion: 1,
      deviceId: context.deviceId,
      afterCursor: null,
      nextCursor: '2',
      hasMore: false,
      events: [
        {
          sequence: '1',
          eventId: 'event-1',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: context.deviceId,
          aggregateType: 'member',
          aggregateId: 'member-1',
          eventType: 'member.created',
          payloadJson: '{"memberId":"member-1"}',
          occurredAt: '2026-06-14T00:00:00.000Z'
        },
        {
          sequence: '2',
          eventId: 'event-2',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: 'other-device',
          aggregateType: 'announcement',
          aggregateId: 'announcement-1',
          eventType: 'announcement.created',
          payloadJson: '{"announcementId":"announcement-1"}',
          occurredAt: '2026-06-14T00:01:00.000Z'
        }
      ],
      serverTime: '2026-06-14T00:02:00.000Z'
    })
    expect(applied).toEqual({
      received: 2,
      skippedOrigin: 1,
      pending: 1,
      nextCursor: '2'
    })
    expect(getLocalSyncStatus(local.connection, context)).toMatchObject({
      pendingInboundEvents: 1,
      pullCursor: '2'
    })
    expect(
      local.connection
        .prepare(
          `SELECT sequence, apply_status FROM sync_inbound_event
           ORDER BY CAST(sequence AS INTEGER)`
        )
        .all()
    ).toEqual([
      { sequence: '1', apply_status: 'skipped_origin' },
      { sequence: '2', apply_status: 'pending' }
    ])

    expect(
      applySyncPullResult(local.connection, context, {
        protocolVersion: 1,
        deviceId: context.deviceId,
        afterCursor: '2',
        nextCursor: '2',
        hasMore: false,
        events: [],
        serverTime: '2026-06-14T00:03:00.000Z'
      })
    ).toMatchObject({ received: 0, nextCursor: '2' })

    expect(() =>
      applySyncPullResult(local.connection, context, {
        protocolVersion: 1,
        deviceId: context.deviceId,
        afterCursor: '2',
        nextCursor: '4',
        hasMore: false,
        events: [
          {
            sequence: '3',
            eventId: 'event-3',
            tenantId: context.tenantId,
            storeId: context.storeId,
            originDeviceId: 'other-device',
            aggregateType: 'announcement',
            aggregateId: 'announcement-2',
            eventType: 'announcement.created',
            payloadJson: '{"announcementId":"announcement-2"}',
            occurredAt: '2026-06-14T00:04:00.000Z'
          },
          {
            sequence: '4',
            eventId: 'event-2',
            tenantId: context.tenantId,
            storeId: context.storeId,
            originDeviceId: 'other-device',
            aggregateType: 'announcement',
            aggregateId: 'announcement-reused',
            eventType: 'announcement.updated',
            payloadJson: '{"announcementId":"announcement-reused"}',
            occurredAt: '2026-06-14T00:05:00.000Z'
          }
        ],
        serverTime: '2026-06-14T00:06:00.000Z'
      })
    ).toThrow('reused with different data')
    expect(getLocalSyncStatus(local.connection, context).pullCursor).toBe('2')
    expect(
      local.connection
        .prepare(
          `SELECT COUNT(*) count FROM sync_inbound_event
           WHERE sequence = '3'`
        )
        .get()
    ).toEqual({ count: 0 })

    local.close()
  })
})
