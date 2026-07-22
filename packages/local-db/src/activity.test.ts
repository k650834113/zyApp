import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashPassword } from '@zyapp/auth'
import { createActivity, listActivities, setActivityStatus } from './activity'
import { bootstrapStore } from './bootstrap'
import { findEmployeeRecordById, getStoreContext } from './identity'
import {
  cashRecharge,
  createMember,
  openLocalDatabase,
  updateRechargeGiftTiers
} from './index'

describe('activity repository', () => {
  it('creates, schedules, publishes, and automatically marks ended activities', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-activity-'))
    const local = openLocalDatabase(join(directory, 'test.db'))
    try {
      const bootstrap = bootstrapStore(local.connection, {
        storeName: 'Activity store',
        deviceName: 'Cashier',
        managerUsername: 'manager',
        managerPasswordHash: await hashPassword('Password123!'),
        managerDisplayName: 'Manager'
      })
      const store = getStoreContext(local.connection)
      if (!store) throw new Error('Store missing')
      const manager = findEmployeeRecordById(
        local.connection,
        store.tenantId,
        bootstrap.managerId
      )
      if (!manager) throw new Error('Manager missing')
      const context = { ...store, actor: manager }
      const activity = createActivity(local.connection, context, {
        title: 'National Day recharge',
        summary: 'Recharge gifts for the holiday',
        content: 'Recharge during the event to receive the configured gift.',
        activityType: 'recharge',
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-10-08T00:00:00.000Z',
        pinned: true,
        allowStoredValue: false,
        allowWechat: true,
        rechargeTiers: [
          { principalFen: 30_000, giftFen: 3_000 },
          { principalFen: 100_000, giftFen: 25_000 }
        ]
      })
      expect(activity.status).toBe('draft')
      const published = setActivityStatus(
        local.connection,
        context,
        activity.id,
        'published',
        'Ready for holiday'
      )
      expect(published.status).toBe('published')
      expect(
        listActivities(
          local.connection,
          store,
          new Date('2026-09-30T00:00:00.000Z')
        )[0]?.visibility
      ).toBe('scheduled')
      expect(
        listActivities(
          local.connection,
          store,
          new Date('2026-10-02T00:00:00.000Z')
        )[0]?.visibility
      ).toBe('active')
      expect(
        listActivities(
          local.connection,
          store,
          new Date('2026-10-09T00:00:00.000Z')
        )[0]?.visibility
      ).toBe('ended')
      expect(
        (
          local.connection
            .prepare(
              `SELECT COUNT(*) count FROM outbox_operation
               WHERE operation_type LIKE 'activity.%'`
            )
            .get() as { count: number }
        ).count
      ).toBe(2)
    } finally {
      local.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('restores edited default recharge tiers when an applied activity is disabled', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-activity-restore-'))
    const local = openLocalDatabase(join(directory, 'test.db'))
    try {
      const bootstrap = bootstrapStore(local.connection, {
        storeName: 'Activity restore store',
        deviceName: 'Cashier',
        managerUsername: 'manager',
        managerPasswordHash: await hashPassword('Password123!'),
        managerDisplayName: 'Manager'
      })
      const store = getStoreContext(local.connection)
      if (!store) throw new Error('Store missing')
      const manager = findEmployeeRecordById(
        local.connection,
        store.tenantId,
        bootstrap.managerId
      )
      if (!manager) throw new Error('Manager missing')
      const context = { ...store, actor: manager }

      updateRechargeGiftTiers(local.connection, context, {
        tiers: [
          { principalFen: 30_000, giftFen: 3_000 },
          { principalFen: 100_000, giftFen: 20_000 }
        ],
        reason: 'Default tier update'
      })
      const activity = createActivity(local.connection, context, {
        title: 'Recharge boost',
        summary: 'Temporary recharge gifts',
        content: 'Recharge 300 and receive 50 during the activity.',
        activityType: 'recharge',
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-10-08T00:00:00.000Z',
        pinned: false,
        allowStoredValue: false,
        allowWechat: true,
        rechargeTiers: [{ principalFen: 30_000, giftFen: 5_000 }]
      })
      const published = setActivityStatus(
        local.connection,
        context,
        activity.id,
        'published',
        'Publish recharge boost'
      )
      updateRechargeGiftTiers(local.connection, context, {
        tiers: published.rechargeTiers.map((tier) => ({
          principalFen: tier.principalFen,
          giftFen: tier.giftFen
        })),
        sourceActivityId: published.id,
        reason: 'Apply recharge boost'
      })

      const boostedMember = createMember(local.connection, context, {
        phone: '13800138100',
        nickname: 'Boosted',
        confirmedAtLeast14: true
      })
      expect(
        cashRecharge(local.connection, context, {
          requestId: randomUUID(),
          memberId: boostedMember.id,
          principalFen: 30_000,
          reason: 'During activity',
          now: new Date('2026-10-02T00:00:00.000Z')
        }).giftDeltaFen
      ).toBe(5_000)

      setActivityStatus(
        local.connection,
        context,
        activity.id,
        'disabled',
        'Stop recharge boost'
      )
      const restoredMember = createMember(local.connection, context, {
        phone: '13800138101',
        nickname: 'Restored',
        confirmedAtLeast14: true
      })
      expect(
        cashRecharge(local.connection, context, {
          requestId: randomUUID(),
          memberId: restoredMember.id,
          principalFen: 30_000,
          reason: 'After activity stop',
          now: new Date('2026-10-02T01:00:00.000Z')
        }).giftDeltaFen
      ).toBe(3_000)
    } finally {
      local.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('restores default recharge tiers before charging after an applied activity ends', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-activity-expired-'))
    const local = openLocalDatabase(join(directory, 'test.db'))
    try {
      const bootstrap = bootstrapStore(local.connection, {
        storeName: 'Activity expired store',
        deviceName: 'Cashier',
        managerUsername: 'manager',
        managerPasswordHash: await hashPassword('Password123!'),
        managerDisplayName: 'Manager'
      })
      const store = getStoreContext(local.connection)
      if (!store) throw new Error('Store missing')
      const manager = findEmployeeRecordById(
        local.connection,
        store.tenantId,
        bootstrap.managerId
      )
      if (!manager) throw new Error('Manager missing')
      const context = { ...store, actor: manager }

      const activity = createActivity(local.connection, context, {
        title: 'Weekend recharge',
        summary: 'Temporary weekend gift',
        content: 'Recharge 300 and receive 50 before the weekend ends.',
        activityType: 'recharge',
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-10-02T00:00:00.000Z',
        pinned: false,
        allowStoredValue: false,
        allowWechat: true,
        rechargeTiers: [{ principalFen: 30_000, giftFen: 5_000 }]
      })
      const published = setActivityStatus(
        local.connection,
        context,
        activity.id,
        'published',
        'Publish weekend recharge'
      )
      updateRechargeGiftTiers(local.connection, context, {
        tiers: published.rechargeTiers.map((tier) => ({
          principalFen: tier.principalFen,
          giftFen: tier.giftFen
        })),
        sourceActivityId: published.id,
        reason: 'Apply weekend recharge'
      })

      const member = createMember(local.connection, context, {
        phone: '13800138102',
        nickname: 'Expired',
        confirmedAtLeast14: true
      })
      expect(
        cashRecharge(local.connection, context, {
          requestId: randomUUID(),
          memberId: member.id,
          principalFen: 30_000,
          reason: 'After activity end',
          now: new Date('2026-10-03T00:00:00.000Z')
        }).giftDeltaFen
      ).toBe(2_000)
    } finally {
      local.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
