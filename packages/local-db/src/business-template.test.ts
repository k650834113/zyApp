import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  createMember,
  findEmployeeRecordById,
  getMonthlyCardDetails,
  getStoreContext,
  getWalletDetails,
  listActivities,
  openLocalDatabase
} from './index'

const directories: string[] = []

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

describe('merchant business templates', () => {
  it('resolves merchant defaults with store overrides and preserves template sources', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-template-'))
    directories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    const bootstrap = bootstrapStore(local.connection, {
      storeName: 'Template Store', managerUsername: 'manager',
      managerPasswordHash: 'scrypt$manager', managerDisplayName: 'Owner',
      deviceName: 'Cashier'
    })
    const store = getStoreContext(local.connection)
    if (!store) throw new Error('Missing store')
    const manager = findEmployeeRecordById(local.connection, store.tenantId, bootstrap.managerId)
    if (!manager) throw new Error('Missing manager')
    const member = createMember(
      local.connection,
      { ...store, actor: manager },
      { phone: '13800138999', nickname: 'Template Member', confirmedAtLeast14: true }
    )
    const now = '2026-07-01T00:00:00.000Z'
    const rechargeTemplateId = randomUUID()
    const monthlyTemplateId = randomUUID()
    const activityTemplateId = randomUUID()
    const insert = local.connection.prepare(
      `INSERT INTO merchant_business_template
       (id, tenant_id, template_type, name, payload_json, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    insert.run(
      rechargeTemplateId, store.tenantId, 'recharge_gift_tier', 'Standard recharge',
      JSON.stringify({ tiers: [{ principalFen: 20_000, giftFen: 2_000 }] }), now, now
    )
    insert.run(
      monthlyTemplateId, store.tenantId, 'monthly_card_plan', 'Merchant monthly card',
      JSON.stringify({ priceFen: 20_000, durationDays: 30, scopeType: 'store' }), now, now
    )
    insert.run(
      activityTemplateId, store.tenantId, 'activity', 'Summer event',
      JSON.stringify({
        title: 'Summer event', summary: 'Template summary', content: 'Template content',
        activityType: 'general', startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-08-01T00:00:00.000Z', pinned: false,
        allowStoredValue: true, allowWechat: false, rechargeTiers: []
      }), now, now
    )
    local.connection.prepare(
      `INSERT INTO store_business_template_override
       (id, tenant_id, store_id, template_id, payload_json, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      randomUUID(), store.tenantId, store.storeId, monthlyTemplateId,
      JSON.stringify({ priceFen: 18_800, scopeType: 'tenant' }), now, now
    )

    const wallet = getWalletDetails(local.connection, store, member.id)
    const monthly = getMonthlyCardDetails(local.connection, store, member.id)
    const activities = listActivities(local.connection, store, new Date(now))
    expect(wallet.giftTiers).toEqual([
      expect.objectContaining({
        principalFen: 20_000, giftFen: 2_000, sourceTemplateId: rechargeTemplateId
      })
    ])
    expect(monthly.plan).toMatchObject({
      priceFen: 18_800,
      durationDays: 30,
      scopeType: 'tenant',
      sourceTemplateId: monthlyTemplateId
    })
    expect(activities).toHaveLength(1)
    expect(activities[0]?.title).toBe('Summer event')
    const activityId = activities[0]?.id
    if (!activityId) throw new Error('Missing materialized activity')
    expect((local.connection.prepare(
      'SELECT source_template_id FROM activity_campaign WHERE id = ?'
    ).get(activityId) as { source_template_id: string }).source_template_id)
      .toBe(activityTemplateId)
    local.close()
  })
})
