import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  createEmployee,
  createMember,
  extendMonthlyCard,
  findEmployeeRecordById,
  getMonthlyCardDetails,
  getStoreContext,
  openLocalDatabase,
  pauseMonthlyCard,
  purchaseMonthlyCard,
  refundMonthlyCard,
  resumeMonthlyCard,
  useMonthlyCard
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function initializedMonthlyCard() {
  const directory = mkdtempSync(join(tmpdir(), 'zyapp-monthly-card-'))
  temporaryDirectories.push(directory)
  const localDatabase = openLocalDatabase(join(directory, 'zyapp.db'))
  const bootstrap = bootstrapStore(localDatabase.connection, {
    storeName: 'Test Store',
    managerUsername: 'manager',
    managerPasswordHash: 'scrypt$manager',
    managerDisplayName: 'Owner',
    deviceName: 'Cashier 01'
  })
  const store = getStoreContext(localDatabase.connection)
  if (!store) throw new Error('Missing store')
  const manager = findEmployeeRecordById(
    localDatabase.connection,
    store.tenantId,
    bootstrap.managerId
  )
  if (!manager) throw new Error('Missing manager')
  const member = createMember(
    localDatabase.connection,
    { ...store, actor: manager },
    {
      phone: '13800138000',
      nickname: '月卡测试',
      confirmedAtLeast14: true
    }
  )
  return { localDatabase, store, manager, member }
}

describe('monthly card repository', () => {
  it('purchases a 200 yuan 30-day cash card idempotently', () => {
    const { localDatabase, store, manager, member } = initializedMonthlyCard()
    const requestId = randomUUID()
    const purchasedAt = new Date('2026-06-01T05:00:00.000Z')
    const first = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId,
        memberId: member.id,
        reason: '现金购买',
        now: purchasedAt
      }
    )
    const repeated = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId,
        memberId: member.id,
        reason: '重复提交',
        now: purchasedAt
      }
    )
    expect(first).toMatchObject({
      priceFen: 20_000,
      status: 'active',
      paymentMethod: 'cash',
      usageCount: 0
    })
    expect(new Date(first.expiresAt).getTime() - purchasedAt.getTime()).toBe(
      30 * 24 * 60 * 60 * 1000
    )
    expect(repeated.id).toBe(first.id)
    expect(
      (
        localDatabase.connection
          .prepare("SELECT COUNT(*) count FROM monthly_card_event WHERE event_type = 'purchased'")
          .get() as { count: number }
      ).count
    ).toBe(1)
    localDatabase.close()
  })

  it('pauses immediately, blocks use, and extends expiry by the paused duration', () => {
    const { localDatabase, store, manager, member } = initializedMonthlyCard()
    const start = new Date('2026-06-01T05:00:00.000Z')
    const card = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), memberId: member.id, reason: '现金购买', now: start }
    )
    const pausedAt = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000)
    const paused = pauseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), cardId: card.id, reason: '顾客申请暂停', now: pausedAt }
    )
    expect(paused.status).toBe('paused')
    expect(() =>
      useMonthlyCard(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          cardId: card.id,
          reason: '入场',
          now: new Date(pausedAt.getTime() + 1)
        }
      )
    ).toThrow('not active')

    const resumedAt = new Date(pausedAt.getTime() + 5 * 24 * 60 * 60 * 1000)
    const resumed = resumeMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        cardId: card.id,
        reason: '顾客恢复',
        now: resumedAt
      }
    )
    expect(resumed.status).toBe('active')
    expect(new Date(resumed.expiresAt).getTime() - new Date(card.expiresAt).getTime()).toBe(
      5 * 24 * 60 * 60 * 1000
    )
    localDatabase.close()
  })

  it('records unlimited uses and exposes expiry without granting use after expiry', () => {
    const { localDatabase, store, manager, member } = initializedMonthlyCard()
    const start = new Date('2026-06-01T05:00:00.000Z')
    const card = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), memberId: member.id, reason: '现金购买', now: start }
    )
    for (let index = 0; index < 3; index += 1) {
      useMonthlyCard(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          cardId: card.id,
          reason: '本人入场',
          now: new Date(start.getTime() + index + 1)
        }
      )
    }
    expect(
      getMonthlyCardDetails(localDatabase.connection, store, member.id, start).current
        ?.usageCount
    ).toBe(3)
    const expiredAt = new Date(start.getTime() + 31 * 24 * 60 * 60 * 1000)
    expect(
      getMonthlyCardDetails(localDatabase.connection, store, member.id, expiredAt).history[0]
        ?.status
    ).toBe('expired')
    expect(() =>
      useMonthlyCard(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          cardId: card.id,
          reason: '过期入场',
          now: expiredAt
        }
      )
    ).toThrow('not active')
    localDatabase.close()
  })

  it('extends monthly cards idempotently, reactivates expired cards, and preserves paused state', () => {
    const { localDatabase, store, manager, member } = initializedMonthlyCard()
    const start = new Date('2026-06-01T05:00:00.000Z')
    const card = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), memberId: member.id, reason: '现金购买', now: start }
    )
    const expiredAt = new Date('2026-07-10T05:00:00.000Z')
    const requestId = randomUUID()
    const extended = extendMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId, cardId: card.id, days: 10, reason: '店长补偿', now: expiredAt }
    )
    const repeated = extendMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId, cardId: card.id, days: 10, reason: '重复提交', now: expiredAt }
    )
    expect(extended.status).toBe('active')
    expect(extended.expiresAt).toBe('2026-07-20T05:00:00.000Z')
    expect(repeated.expiresAt).toBe(extended.expiresAt)
    expect(
      (localDatabase.connection.prepare(
        "SELECT COUNT(*) count FROM monthly_card_event WHERE event_type = 'manual_extended'"
      ).get() as { count: number }).count
    ).toBe(1)
    expect((localDatabase.connection.prepare(
      "SELECT COUNT(*) count FROM audit_log WHERE action = 'monthly_card.manual_extended'"
    ).get() as { count: number }).count).toBe(1)
    expect((localDatabase.connection.prepare(
      "SELECT COUNT(*) count FROM outbox_operation WHERE operation_type = 'monthly_card.manual_extended'"
    ).get() as { count: number }).count).toBe(1)
    const metadata = localDatabase.connection.prepare(
      "SELECT metadata_json FROM monthly_card_event WHERE event_type = 'manual_extended'"
    ).get() as { metadata_json: string }
    expect(JSON.parse(metadata.metadata_json)).toMatchObject({
      days: 10,
      beforeExpiresAt: card.expiresAt,
      afterExpiresAt: extended.expiresAt,
      reactivated: true
    })

    const paused = pauseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), cardId: card.id, reason: '客户暂停', now: expiredAt }
    )
    const pausedExtended = extendMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), cardId: card.id, days: 5, reason: '暂停期补偿', now: expiredAt }
    )
    expect(paused.status).toBe('paused')
    expect(pausedExtended.status).toBe('paused')
    expect(pausedExtended.expiresAt).toBe('2026-07-25T05:00:00.000Z')
    localDatabase.close()
  })

  it('rejects invalid extension days, staff, and refunded cards', () => {
    const { localDatabase, store, manager, member } = initializedMonthlyCard()
    const staff = createEmployee(
      localDatabase.connection,
      { ...store, actorId: manager.id },
      { username: 'extendstaff', passwordHash: 'scrypt$staff', displayName: 'Staff', role: 'staff' }
    )
    const start = new Date('2026-06-01T05:00:00.000Z')
    const card = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), memberId: member.id, reason: '现金购买', now: start }
    )
    expect(() => extendMonthlyCard(
      localDatabase.connection,
      { ...store, actor: staff },
      { requestId: randomUUID(), cardId: card.id, days: 1, reason: '无权操作', now: start }
    )).toThrow('Only managers')
    expect(() => extendMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), cardId: card.id, days: 366, reason: '超出范围', now: start }
    )).toThrow('1 to 365')
    for (const days of [0, -1, 1.5]) {
      expect(() => extendMonthlyCard(
        localDatabase.connection,
        { ...store, actor: manager },
        { requestId: randomUUID(), cardId: card.id, days, reason: '非法天数', now: start }
      )).toThrow()
    }
    expect(() => extendMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), cardId: card.id, days: 1, reason: ' ', now: start }
    )).toThrow('reason')
    refundMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), cardId: card.id, reason: '购买错误', now: start }
    )
    expect(() => extendMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), cardId: card.id, days: 1, reason: '退款后延期', now: start }
    )).toThrow('refunded or voided')
    localDatabase.close()
  })

  it('rolls back projection, event, audit, and outbox together when extension event insertion fails', () => {
    const { localDatabase, store, manager, member } = initializedMonthlyCard()
    const start = new Date('2026-06-01T05:00:00.000Z')
    const card = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), memberId: member.id, reason: '现金购买', now: start }
    )
    localDatabase.connection.exec(
      `CREATE TRIGGER fail_manual_extension
       BEFORE INSERT ON monthly_card_event
       WHEN NEW.event_type = 'manual_extended'
       BEGIN SELECT RAISE(ABORT, 'forced extension failure'); END`
    )
    expect(() => extendMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), cardId: card.id, days: 10, reason: '故障回滚', now: start }
    )).toThrow('forced extension failure')
    const persisted = localDatabase.connection.prepare(
      'SELECT expires_at FROM monthly_card WHERE id = ?'
    ).get(card.id) as { expires_at: string }
    expect(persisted.expires_at).toBe(card.expiresAt)
    expect((localDatabase.connection.prepare(
      "SELECT COUNT(*) count FROM monthly_card_event WHERE event_type = 'manual_extended'"
    ).get() as { count: number }).count).toBe(0)
    expect((localDatabase.connection.prepare(
      "SELECT COUNT(*) count FROM audit_log WHERE action = 'monthly_card.manual_extended'"
    ).get() as { count: number }).count).toBe(0)
    expect((localDatabase.connection.prepare(
      "SELECT COUNT(*) count FROM outbox_operation WHERE operation_type = 'monthly_card.manual_extended'"
    ).get() as { count: number }).count).toBe(0)
    localDatabase.close()
  })

  it('defaults cards to store scope and only exposes tenant cards across stores', () => {
    const { localDatabase, store, manager, member } = initializedMonthlyCard()
    const otherStoreId = randomUUID()
    const timestamp = '2026-06-01T00:00:00.000Z'
    localDatabase.connection.prepare(
      `INSERT INTO store
       (id, tenant_id, name, timezone, business_open_minute,
        business_close_minute, status_override, created_at, updated_at)
       VALUES (?, ?, 'Other Store', 'Asia/Shanghai', 780, 1380, 'automatic', ?, ?)`
    ).run(otherStoreId, store.tenantId, timestamp, timestamp)
    const storeCard = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), memberId: member.id, reason: 'Store card', now: new Date(timestamp) }
    )
    expect(storeCard.scopeType).toBe('store')
    expect(
      getMonthlyCardDetails(
        localDatabase.connection,
        { ...store, storeId: otherStoreId },
        member.id,
        new Date(timestamp)
      ).current
    ).toBeNull()
    expect(() => useMonthlyCard(
      localDatabase.connection,
      { ...store, storeId: otherStoreId, actor: manager },
      { requestId: randomUUID(), cardId: storeCard.id, reason: 'Cross-store use', now: new Date(timestamp) }
    )).toThrow('issuing store')

    const tenantMember = createMember(
      localDatabase.connection,
      { ...store, actor: manager },
      { phone: '13800138009', nickname: 'Tenant Card', confirmedAtLeast14: true }
    )
    localDatabase.connection.prepare(
      `UPDATE monthly_card_plan SET scope_type = 'tenant'
       WHERE tenant_id = ? AND store_id = ?`
    ).run(store.tenantId, store.storeId)
    const tenantCard = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), memberId: tenantMember.id, reason: 'Tenant card', now: new Date(timestamp) }
    )
    expect(tenantCard.scopeType).toBe('tenant')
    expect(
      getMonthlyCardDetails(
        localDatabase.connection,
        { ...store, storeId: otherStoreId },
        tenantMember.id,
        new Date(timestamp)
      ).current?.id
    ).toBe(tenantCard.id)
    localDatabase.close()
  })

  it('allows manager standard refund only within 24 hours and before use', () => {
    const { localDatabase, store, manager, member } = initializedMonthlyCard()
    const staff = createEmployee(
      localDatabase.connection,
      { ...store, actorId: manager.id },
      {
        username: 'staff01',
        passwordHash: 'scrypt$staff',
        displayName: 'Staff',
        role: 'staff'
      }
    )
    const start = new Date('2026-06-01T05:00:00.000Z')
    const card = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      { requestId: randomUUID(), memberId: member.id, reason: '现金购买', now: start }
    )
    expect(() =>
      refundMonthlyCard(
        localDatabase.connection,
        { ...store, actor: staff },
        {
          requestId: randomUUID(),
          cardId: card.id,
          reason: '线下申请',
          now: new Date(start.getTime() + 1_000)
        }
      )
    ).toThrow('Only managers')
    const refunded = refundMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        cardId: card.id,
        reason: '购买错误',
        now: new Date(start.getTime() + 23 * 60 * 60 * 1000)
      }
    )
    expect(refunded.status).toBe('refunded')

    const second = purchaseMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: member.id,
        reason: '再次购买',
        now: new Date(start.getTime() + 24 * 60 * 60 * 1000)
      }
    )
    useMonthlyCard(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        cardId: second.id,
        reason: '本人入场',
        now: new Date(start.getTime() + 24 * 60 * 60 * 1000 + 1)
      }
    )
    expect(() =>
      refundMonthlyCard(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          requestId: randomUUID(),
          cardId: second.id,
          reason: '已使用',
          now: new Date(start.getTime() + 24 * 60 * 60 * 1000 + 2)
        }
      )
    ).toThrow('used')
    localDatabase.close()
  })
})
