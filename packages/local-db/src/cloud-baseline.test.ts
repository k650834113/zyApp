import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashPassword } from '@zyapp/auth'
import { bootstrapStore } from './bootstrap'
import { ensureCloudBaselineOutbox } from './cloud-baseline'
import { findEmployeeRecordById, getStoreContext } from './identity'
import { openLocalDatabase } from './index'
import { createMember } from './member'

describe('cloud baseline outbox', () => {
  it('adds only missing state snapshots and is repeatable', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-cloud-baseline-'))
    const local = openLocalDatabase(join(directory, 'test.db'))
    try {
      const bootstrap = bootstrapStore(local.connection, {
        storeName: 'Cloud baseline store',
        deviceName: 'Cashier',
        managerUsername: 'manager',
        managerPasswordHash: await hashPassword('Password123!'),
        managerDisplayName: 'Manager'
      })
      const context = getStoreContext(local.connection)
      if (!context) throw new Error('Store context is missing')
      const manager = findEmployeeRecordById(
        local.connection,
        context.tenantId,
        bootstrap.managerId
      )
      if (!manager) throw new Error('Manager is missing')

      createMember(
        local.connection,
        { ...context, actor: manager },
        {
          phone: '13800138000',
          nickname: 'Existing outbox member',
          confirmedAtLeast14: true
        }
      )
      local.connection
        .prepare(
          `INSERT INTO activity_campaign
           (id, tenant_id, store_id, title, summary, content, activity_type,
            status, starts_at, ends_at, pinned, allow_stored_value,
            allow_wechat, created_by, created_at, updated_at)
           VALUES ('activity-existing', ?, ?, 'Existing activity', 'Summary',
                   'Content', 'general', 'published',
                   '2026-06-01T00:00:00.000Z',
                   '2026-07-01T00:00:00.000Z', 1, 1, 1, ?, ?, ?)`
        )
        .run(
          context.tenantId,
          context.storeId,
          manager.id,
          '2026-06-01T00:00:00.000Z',
          '2026-06-01T00:00:00.000Z'
        )
      local.connection
        .prepare(
          `INSERT INTO announcement
           (id, tenant_id, store_id, title, content, status, pinned,
            visible_from, created_by, published_at, created_at, updated_at)
           VALUES ('announcement-existing', ?, ?, 'Existing notice',
                   'Notice content', 'published', 1,
                   '2026-06-01T00:00:00.000Z', ?,
                   '2026-06-01T00:00:00.000Z',
                   '2026-06-01T00:00:00.000Z',
                   '2026-06-01T00:00:00.000Z')`
        )
        .run(context.tenantId, context.storeId, manager.id)
      local.connection
        .prepare(
          `INSERT INTO board_game
           (id, tenant_id, store_id, name, introduction, categories_json,
            min_players, max_players, difficulty, quantity, record_status,
            available, customer_consigned, missing_pieces, private,
            recommended, complexity_tenths, bgg_id, metadata_source,
            metadata_imported_at, created_by, created_at, updated_at)
           VALUES ('game-existing', ?, ?, 'Existing game',
                   'Existing introduction', '["Family"]', 1, 4, 'light', 1,
                   'active', 1, 0, 0, 0, 1, 23, 13, 'bgg',
                   '2026-08-03T00:00:00.000Z', ?,
                   '2026-06-01T00:00:00.000Z',
                   '2026-06-01T00:00:00.000Z')`
        )
        .run(context.tenantId, context.storeId, manager.id)

      const first = ensureCloudBaselineOutbox(
        local.connection,
        context,
        manager.id,
        new Date('2026-06-13T00:00:00.000Z')
      )
      expect(first.byType).toMatchObject({
        'employee.snapshot': 1,
        'catalog.snapshot': 1,
        'activity.snapshot': 1,
        'announcement.snapshot': 1,
        'board_game.snapshot': 1,
        'wallet.gift_tiers.updated': 1
      })
      expect(first.byType['member.snapshot']).toBeUndefined()
      expect(
        (
          local.connection
            .prepare(
              `SELECT COUNT(*) count FROM outbox_operation
               WHERE operation_type IN (
                 'employee.snapshot', 'catalog.snapshot',
                 'activity.snapshot', 'announcement.snapshot',
                 'board_game.snapshot',
                 'wallet.gift_tiers.updated'
               )`
            )
            .get() as { count: number }
        ).count
      ).toBe(6)
      const employeePayload = local.connection
        .prepare(
          `SELECT payload_json FROM outbox_operation
           WHERE operation_type = 'employee.snapshot'`
        )
        .get() as { payload_json: string }
      expect(employeePayload.payload_json).not.toContain('password')
      const boardGamePayload = local.connection
        .prepare(
          `SELECT payload_json FROM outbox_operation
           WHERE operation_type = 'board_game.snapshot'`
        )
        .get() as { payload_json: string }
      expect(JSON.parse(boardGamePayload.payload_json).after).toMatchObject({
        complexityRating: 2.3,
        bggId: 13,
        metadataSource: 'bgg',
        metadataImportedAt: '2026-08-03T00:00:00.000Z'
      })

      const second = ensureCloudBaselineOutbox(
        local.connection,
        context,
        manager.id,
        new Date('2026-06-13T00:01:00.000Z')
      )
      expect(second).toEqual({ created: 0, byType: {} })
    } finally {
      local.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
