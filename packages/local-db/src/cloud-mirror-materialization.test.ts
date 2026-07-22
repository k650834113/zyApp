import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapStore } from './bootstrap'
import { applyCloudMirrorPage } from './cloud-mirror-materialization'
import { getStoreContext } from './identity'
import { openLocalDatabase } from './index'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('cloud mirror materialization', () => {
  it('materializes members, wallet balances and completed orders into the business mirror', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-cloud-materialize-'))
    directories.push(directory)
    const local = openLocalDatabase(join(directory, 'mirror.db'))
    try {
      bootstrapStore(local.connection, {
        storeName: 'Mirror Store',
        managerUsername: 'manager',
        managerPasswordHash: 'scrypt$test',
        managerDisplayName: 'Manager',
        deviceName: 'Second Device'
      })
      const context = getStoreContext(local.connection)
      if (!context) throw new Error('Missing context')
      const now = '2026-06-30T10:00:00.000Z'
      const memberId = '11111111-1111-4111-8111-111111111111'
      const walletId = '22222222-2222-4222-8222-222222222222'
      const orderId = '33333333-3333-4333-8333-333333333333'
      const itemId = '44444444-4444-4444-8444-444444444444'
      const catalogId = '55555555-5555-4555-8555-555555555555'

      applyCloudMirrorPage(local.connection, context, {
        resource: 'members',
        rows: [{ id: memberId, payload: {
          id: memberId,
          member_number: 'M0001',
          phone: '13800138000',
          nickname: 'Cloud Member',
          status: 'active',
          birthday_month: null,
          birthday_day: null,
          birthday_source: null,
          tier: 'advanced',
          age_gate_status: 'confirmed_at_least_14',
          note: null,
          source: 'legacy',
          created_at: now,
          updated_at: now
        }}],
        nextCursor: null,
        eventCursor: '10',
        serverTime: now
      })
      applyCloudMirrorPage(local.connection, context, {
        resource: 'wallet_accounts',
        rows: [{ id: walletId, payload: {
          id: walletId,
          member_id: memberId,
          status: 'active',
          principal_balance_fen: 6000,
          gift_balance_fen: 500,
          created_at: now,
          updated_at: now
        }}],
        nextCursor: null,
        eventCursor: '11',
        serverTime: now
      })
      applyCloudMirrorPage(local.connection, context, {
        resource: 'orders',
        rows: [{ id: orderId, payload: {
          id: orderId,
          order_number: 'O20260630-CLOUD',
          visit_batch_id: '66666666-6666-4666-8666-666666666666',
          customer_member_id: memberId,
          payment_method: 'cash',
          wallet_member_id: null,
          total_fen: 4000,
          note: null,
          completed_at: now,
          payload_json: {
            id: orderId,
            orderNumber: 'O20260630-CLOUD',
            visitBatchId: '66666666-6666-4666-8666-666666666666',
            customerMemberId: memberId,
            paymentMethod: 'cash',
            walletMemberId: null,
            status: 'completed',
            totalFen: 4000,
            note: null,
            completedAt: now,
            items: [{
              id: itemId,
              catalogItemId: catalogId,
              itemName: '入场费',
              itemType: 'admission',
              regularPriceFen: 4000,
              advancedPriceFen: 3000,
              appliedUnitPriceFen: 4000,
              pricingTier: 'regular',
              quantity: 1,
              lineTotalFen: 4000,
              benefitType: 'none',
              beneficiaryMemberId: null
            }]
          }
        }}],
        nextCursor: null,
        eventCursor: '12',
        serverTime: now
      })

      expect(local.connection.prepare('SELECT nickname FROM member WHERE id = ?').get(memberId)).toEqual({ nickname: 'Cloud Member' })
      expect(local.connection.prepare(
        `SELECT source_type, source_id FROM membership_grant
         WHERE member_id = ? AND revoked_at IS NULL`
      ).get(memberId)).toEqual({
        source_type: 'legacy',
        source_id: `cloud-member-tier:${memberId}`
      })
      expect(local.connection.prepare('SELECT principal_balance_fen, gift_balance_fen FROM wallet_account WHERE id = ?').get(walletId)).toEqual({ principal_balance_fen: 6000, gift_balance_fen: 500 })
      expect(local.connection.prepare('SELECT total_fen FROM sales_order WHERE id = ?').get(orderId)).toEqual({ total_fen: 4000 })
      expect(local.connection.prepare('SELECT COUNT(*) count FROM sales_order_item WHERE order_id = ?').get(orderId)).toEqual({ count: 1 })

      local.connection.prepare(
        `INSERT INTO wallet_lot
         (id, tenant_id, store_id, wallet_account_id, member_id, source_type,
          source_id, original_principal_fen, original_gift_fen,
          remaining_principal_fen, remaining_gift_fen, created_at, updated_at)
         VALUES ('local-recharge-lot', ?, ?, ?, ?, 'recharge',
                 'local-recharge', 1000, 100, 1000, 100, ?, ?)`
      ).run(context.tenantId, context.storeId, walletId, memberId, now, now)
      applyCloudMirrorPage(local.connection, context, {
        resource: 'wallet_accounts',
        rows: [{ id: walletId, payload: {
          id: walletId,
          member_id: memberId,
          status: 'active',
          principal_balance_fen: 7000,
          gift_balance_fen: 600,
          created_at: now,
          updated_at: '2026-06-30T10:01:00.000Z'
        }}],
        nextCursor: null,
        eventCursor: '13',
        serverTime: '2026-06-30T10:01:00.000Z'
      })
      expect(local.connection.prepare(
        `SELECT SUM(remaining_principal_fen) principal_fen,
                SUM(remaining_gift_fen) gift_fen
         FROM wallet_lot WHERE wallet_account_id = ?`
      ).get(walletId)).toEqual({ principal_fen: 7000, gift_fen: 600 })
    } finally {
      local.close()
    }
  })
})
