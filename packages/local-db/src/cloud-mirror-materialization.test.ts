import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapStore } from './bootstrap'
import { applyCloudMirrorPage } from './cloud-mirror-materialization'
import { getStoreContext } from './identity'
import {
  cashRecharge,
  createMember,
  findEmployeeRecordById,
  getMonthlyCardDetails,
  openLocalDatabase
} from './index'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('cloud mirror materialization', () => {
  it('stores board-game complexity as validated integer tenths with provenance', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-board-game-mirror-'))
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
      const now = '2026-08-03T00:00:00.000Z'

      applyCloudMirrorPage(local.connection, context, {
        resource: 'board_games',
        rows: [{
          id: 'board-game-mirror',
          payload: {
            id: 'board-game-mirror',
            name: 'Cascadia',
            introduction: 'A family strategy game.',
            categories_json: ['Family', 'Strategy'],
            min_players: 1,
            max_players: 4,
            min_minutes: 30,
            max_minutes: 45,
            difficulty: 'medium',
            complexity_rating: '2.3',
            quantity: 2,
            record_status: 'active',
            available: true,
            customer_consigned: false,
            missing_pieces: false,
            private: false,
            recommended: true,
            image_url: null,
            bgg_id: 295947,
            metadata_source: 'bgg',
            metadata_imported_at: now,
            customer_note: null,
            internal_note: null,
            consignor_nickname: null,
            missing_parts_json: [],
            created_at: now,
            updated_at: now
          }
        }],
        nextCursor: null,
        eventCursor: '1',
        serverTime: now
      })

      expect(local.connection.prepare(
        `SELECT complexity_tenths, metadata_source, metadata_imported_at
         FROM board_game WHERE id = 'board-game-mirror'`
      ).get()).toEqual({
        complexity_tenths: 23,
        metadata_source: 'bgg',
        metadata_imported_at: now
      })
    } finally {
      local.close()
    }
  })

  it('suppresses a confirmed local wallet echo while keeping a new cloud recharge', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-wallet-ledger-mirror-'))
    directories.push(directory)
    const local = openLocalDatabase(join(directory, 'mirror.db'))
    try {
      const bootstrap = bootstrapStore(local.connection, {
        storeName: 'Mirror Store',
        managerUsername: 'manager',
        managerPasswordHash: 'scrypt$test',
        managerDisplayName: 'Manager',
        deviceName: 'Second Device'
      })
      const context = getStoreContext(local.connection)
      if (!context) throw new Error('Missing context')
      const manager = findEmployeeRecordById(
        local.connection,
        context.tenantId,
        bootstrap.managerId
      )
      if (!manager) throw new Error('Missing manager')
      const member = createMember(
        local.connection,
        { ...context, actor: manager },
        {
          phone: '13800138000',
          nickname: 'Local Member',
          confirmedAtLeast14: true
        }
      )
      const recharge = cashRecharge(
        local.connection,
        { ...context, actor: manager },
        {
          requestId: 'local-cash-recharge',
          memberId: member.id,
          principalFen: 50_000,
          reason: 'Local cash recharge',
          now: new Date('2026-07-25T10:00:00.000Z')
        }
      )
      const localEntry = local.connection
        .prepare(
          `SELECT wallet_account_id, source_id, principal_delta_fen,
                  gift_delta_fen, principal_balance_after_fen,
                  gift_balance_after_fen
           FROM wallet_ledger
           WHERE tenant_id = ? AND member_id = ? AND source_id = ?`
        )
        .get(context.tenantId, member.id, recharge.operationId) as
        | {
            wallet_account_id: string
            source_id: string
            principal_delta_fen: number
            gift_delta_fen: number
            principal_balance_after_fen: number
            gift_balance_after_fen: number
          }
        | undefined
      if (!localEntry) throw new Error('Missing local wallet entry')

      applyCloudMirrorPage(local.connection, context, {
        resource: 'wallet_ledger',
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          payload: {
            operation_id: '11111111-1111-4111-8111-111111111111',
            store_id: context.storeId,
            wallet_account_id: localEntry.wallet_account_id,
            member_id: member.id,
            event_type: 'wallet.cash_recharged',
            principal_delta_fen: localEntry.principal_delta_fen,
            gift_delta_fen: localEntry.gift_delta_fen,
            principal_balance_after_fen: localEntry.principal_balance_after_fen,
            gift_balance_after_fen: localEntry.gift_balance_after_fen,
            source_operation_id: localEntry.source_id,
            reason: 'Confirmed by cloud later',
            payload_json: {},
            occurred_at: '2026-07-25T10:05:00.000Z'
          }
        }],
        nextCursor: null,
        eventCursor: '40',
        serverTime: '2026-07-25T10:05:00.000Z'
      })

      expect(
        local.connection.prepare(
          `SELECT COUNT(*) count FROM wallet_ledger
           WHERE member_id = ? AND source_id = ?`
        ).get(member.id, localEntry.source_id)
      ).toEqual({ count: 1 })

      const wechatSourceId = '22222222-2222-4222-8222-222222222222'
      applyCloudMirrorPage(local.connection, context, {
        resource: 'wallet_ledger',
        rows: [{
          id: '33333333-3333-4333-8333-333333333333',
          payload: {
            operation_id: '33333333-3333-4333-8333-333333333333',
            store_id: context.storeId,
            wallet_account_id: localEntry.wallet_account_id,
            member_id: member.id,
            event_type: 'wallet.wechat_recharged',
            principal_delta_fen: 2_000,
            gift_delta_fen: 0,
            principal_balance_after_fen:
              localEntry.principal_balance_after_fen + 2_000,
            gift_balance_after_fen: localEntry.gift_balance_after_fen,
            source_operation_id: wechatSourceId,
            reason: 'Miniapp WeChat recharge',
            payload_json: {},
            occurred_at: '2026-07-25T10:06:00.000Z'
          }
        }],
        nextCursor: null,
        eventCursor: '41',
        serverTime: '2026-07-25T10:06:00.000Z'
      })

      expect(
        local.connection.prepare(
          `SELECT COUNT(*) count FROM wallet_ledger
           WHERE member_id = ? AND source_id = ? AND actor_id = 'cloud-sync'`
        ).get(member.id, wechatSourceId)
      ).toEqual({ count: 1 })
    } finally {
      local.close()
    }
  })

  it('preserves a WeChat monthly-card payment method for PC display', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-monthly-mirror-'))
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
      const now = '2026-07-25T10:00:00.000Z'
      const memberId = '11111111-1111-4111-8111-111111111111'
      const cardId = '22222222-2222-4222-8222-222222222222'

      applyCloudMirrorPage(local.connection, context, {
        resource: 'members',
        rows: [{
          id: memberId,
          payload: {
            id: memberId,
            member_number: 'M0001',
            phone: '13800138000',
            nickname: 'Cloud Member',
            status: 'active',
            birthday_month: null,
            birthday_day: null,
            birthday_source: null,
            tier: 'ordinary',
            age_gate_status: 'confirmed_at_least_14',
            note: null,
            source: 'miniapp',
            created_at: now,
            updated_at: now
          }
        }],
        nextCursor: null,
        eventCursor: '30',
        serverTime: now
      })
      applyCloudMirrorPage(local.connection, context, {
        resource: 'monthly_cards',
        rows: [{
          id: cardId,
          payload: {
            id: cardId,
            store_id: context.storeId,
            member_id: memberId,
            plan_name: '30 天月卡',
            price_fen: 20_000,
            payment_method: 'wechat',
            status: 'active',
            purchased_at: now,
            starts_at: now,
            expires_at: '2026-08-24T10:00:00.000Z',
            paused_at: null,
            updated_at: now,
            scope_type: 'store'
          }
        }],
        nextCursor: null,
        eventCursor: '31',
        serverTime: now
      })
      applyCloudMirrorPage(local.connection, context, {
        resource: 'monthly_card_payment_orders',
        rows: [{
          id: '33333333-3333-4333-8333-333333333333',
          payload: {
            id: '33333333-3333-4333-8333-333333333333',
            store_id: context.storeId,
            member_id: memberId,
            identity_id: '44444444-4444-4444-8444-444444444444',
            request_id: 'monthly-card-settled',
            out_trade_no: 'ZYMC-SETTLED',
            provider_mode: 'wechat',
            provider_prepay_id: 'wx-prepay-monthly',
            provider_transaction_id: 'wx-transaction-monthly',
            plan_name: '30 day monthly card',
            price_fen: 20_000,
            duration_days: 30,
            scope_type: 'store',
            status: 'settled',
            target_card_id: cardId,
            expires_before: null,
            expires_after: '2026-08-24T10:00:00.000Z',
            error_message: null,
            expires_at: '2026-07-25T10:15:00.000Z',
            paid_at: '2026-07-25T10:01:00.000Z',
            settled_at: '2026-07-25T10:01:00.000Z',
            created_at: now,
            updated_at: '2026-07-25T10:01:00.000Z'
          }
        }],
        nextCursor: null,
        eventCursor: '32',
        serverTime: now
      })

      expect(
        local.connection
          .prepare('SELECT payment_method, source FROM monthly_card WHERE id = ?')
          .get(cardId)
      ).toEqual({ payment_method: 'wechat', source: 'cloud' })
      expect(
        getMonthlyCardDetails(local.connection, context, memberId).current
      ).toMatchObject({ id: cardId, paymentMethod: 'wechat' })
      expect(
        local.connection
          .prepare(
            `SELECT out_trade_no, status, target_card_id, expires_after
             FROM wechat_monthly_card_order_mirror WHERE member_id = ?`
          )
          .get(memberId)
      ).toEqual({
        out_trade_no: 'ZYMC-SETTLED',
        status: 'settled',
        target_card_id: cardId,
        expires_after: '2026-08-24T10:00:00.000Z'
      })
    } finally {
      local.close()
    }
  })

  it('stores settled and pending WeChat recharge orders without writing wallet entries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-recharge-mirror-'))
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
      const now = '2026-07-25T10:00:00.000Z'
      const memberId = '11111111-1111-4111-8111-111111111111'
      applyCloudMirrorPage(local.connection, context, {
        resource: 'members',
        rows: [{
          id: memberId,
          payload: {
            id: memberId,
            member_number: 'M0001',
            phone: '13800138000',
            nickname: 'Cloud Member',
            status: 'active',
            birthday_month: null,
            birthday_day: null,
            birthday_source: null,
            tier: 'ordinary',
            age_gate_status: 'confirmed_at_least_14',
            note: null,
            source: 'miniapp',
            created_at: now,
            updated_at: now
          }
        }],
        nextCursor: null,
        eventCursor: '20',
        serverTime: now
      })

      applyCloudMirrorPage(local.connection, context, {
        resource: 'wechat_recharge_orders',
        rows: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            payload: {
              id: '22222222-2222-4222-8222-222222222222',
              store_id: context.storeId,
              member_id: memberId,
              identity_id: '33333333-3333-4333-8333-333333333333',
              request_id: 'recharge-settled',
              out_trade_no: 'ZYT-SETTLED',
              provider_mode: 'wechat',
              provider_prepay_id: 'wx-prepay-settled',
              provider_transaction_id: 'wx-transaction-settled',
              principal_fen: 100,
              gift_fen: 10,
              status: 'settled',
              error_message: null,
              expires_at: '2026-07-25T10:15:00.000Z',
              paid_at: '2026-07-25T10:01:00.000Z',
              settled_at: '2026-07-25T10:01:00.000Z',
              wallet_operation_id:
                '44444444-4444-4444-8444-444444444444',
              created_at: now,
              updated_at: '2026-07-25T10:01:00.000Z'
            }
          },
          {
            id: '55555555-5555-4555-8555-555555555555',
            payload: {
              id: '55555555-5555-4555-8555-555555555555',
              store_id: context.storeId,
              member_id: memberId,
              identity_id: '33333333-3333-4333-8333-333333333333',
              request_id: 'recharge-pending',
              out_trade_no: 'ZYT-PENDING',
              provider_mode: 'wechat',
              provider_prepay_id: 'wx-prepay-pending',
              provider_transaction_id: null,
              principal_fen: 200,
              gift_fen: 20,
              status: 'pending_payment',
              error_message: null,
              expires_at: '2026-07-25T10:15:00.000Z',
              paid_at: null,
              settled_at: null,
              wallet_operation_id: null,
              created_at: now,
              updated_at: now
            }
          }
        ],
        nextCursor: null,
        eventCursor: '21',
        serverTime: now
      })

      expect(
        local.connection
          .prepare(
            `SELECT out_trade_no, status, provider_transaction_id,
                    wallet_operation_id
             FROM wechat_recharge_order_mirror
             ORDER BY out_trade_no`
          )
          .all()
      ).toEqual([
        {
          out_trade_no: 'ZYT-PENDING',
          status: 'pending_payment',
          provider_transaction_id: null,
          wallet_operation_id: null
        },
        {
          out_trade_no: 'ZYT-SETTLED',
          status: 'settled',
          provider_transaction_id: 'wx-transaction-settled',
          wallet_operation_id: '44444444-4444-4444-8444-444444444444'
        }
      ])
      expect(
        local.connection
          .prepare(
            'SELECT COUNT(*) count FROM wallet_ledger'
          )
          .get()
      ).toEqual({ count: 0 })
    } finally {
      local.close()
    }
  })

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
