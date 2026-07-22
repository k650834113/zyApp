import type { PoolClient } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import {
  processFinancialSyncOperation,
  type FinancialHandlerSupport
} from './financial-sync-operation-handler'
import type { ReceivedOperation } from './sync-operation-handler'

function operation(
  operationType: string,
  aggregateId: string,
  payload: Record<string, unknown>
): ReceivedOperation {
  return {
    operation_id: '11111111-1111-4111-8111-111111111111',
    device_id: '22222222-2222-4222-8222-222222222222',
    device_seq: 2,
    tenant_id: '33333333-3333-4333-8333-333333333333',
    store_id: '44444444-4444-4444-8444-444444444444',
    actor_id: '55555555-5555-4555-8555-555555555555',
    operation_type: operationType,
    aggregate_id: aggregateId,
    occurred_at: new Date('2026-06-13T00:00:00.000Z'),
    payload_json: payload
  }
}

function support() {
  const appendEvent = vi.fn(async () => 42)
  const completeOperation = vi.fn(async () => undefined)
  const markConflict = vi.fn(async () => 'conflict' as const)
  return {
    value: {
      appendEvent,
      completeOperation,
      markConflict
    } satisfies FinancialHandlerSupport,
    appendEvent,
    completeOperation,
    markConflict
  }
}

function emptyClient() {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes('SELECT id FROM cloud_member')
      ? [{ id: '77777777-7777-4777-8777-777777777777' }]
      : [],
    rowCount: sql.includes('SELECT id FROM cloud_member') ? 1 : 0
  }))
  return {
    value: { query } as unknown as PoolClient,
    query
  }
}

describe('cloud financial sync operation handler', () => {
  it('projects a valid wallet snapshot into account and append-only ledger writes', async () => {
    const walletId = '66666666-6666-4666-8666-666666666666'
    const client = emptyClient()
    const callbacks = support()
    const result = await processFinancialSyncOperation(
      client.value,
      operation('wallet.snapshot', walletId, {
        action: 'wallet.snapshot',
        before: null,
        after: {
          operationId: `snapshot:${walletId}`,
          wallet: {
            accountId: walletId,
            memberId: '77777777-7777-4777-8777-777777777777',
            principalBalanceFen: 50_000,
            giftBalanceFen: 5_000,
            totalBalanceFen: 55_000,
            status: 'active',
            updatedAt: '2026-06-12T00:00:00.000Z'
          },
          principalDeltaFen: 50_000,
          giftDeltaFen: 5_000
        },
        reason: 'baseline'
      }),
      callbacks.value
    )

    expect(result).toBe('confirmed')
    expect(callbacks.appendEvent).toHaveBeenCalledWith(
      client.value,
      expect.anything(),
      'wallet'
    )
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO cloud_wallet_account')
      )
    ).toBe(true)
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO cloud_wallet_ledger')
      )
    ).toBe(true)
    expect(callbacks.completeOperation).toHaveBeenCalled()
  })

  it('turns malformed money into a wallet conflict before writing an event', async () => {
    const walletId = '66666666-6666-4666-8666-666666666666'
    const client = emptyClient()
    const callbacks = support()
    const result = await processFinancialSyncOperation(
      client.value,
      operation('wallet.snapshot', walletId, {
        after: {
          operationId: `snapshot:${walletId}`,
          wallet: {
            accountId: walletId,
            memberId: '77777777-7777-4777-8777-777777777777',
            principalBalanceFen: 50_000.5,
            giftBalanceFen: 0,
            totalBalanceFen: 50_000.5,
            status: 'active',
            updatedAt: '2026-06-12T00:00:00.000Z'
          },
          principalDeltaFen: 50_000.5,
          giftDeltaFen: 0
        }
      }),
      callbacks.value
    )

    expect(result).toBe('conflict')
    expect(callbacks.markConflict).toHaveBeenCalledWith(
      client.value,
      expect.anything(),
      'wallet_authority_conflict',
      expect.stringContaining('integer')
    )
    expect(callbacks.appendEvent).not.toHaveBeenCalled()
  })

  it('merges an offline wallet delta after a cloud recharge without overwriting either side', async () => {
    const localWalletId = '66666666-6666-4666-8666-666666666666'
    const cloudWalletId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const query = vi.fn(async (sql: string, _parameters: unknown[] = []) => {
      if (sql.includes('SELECT id FROM cloud_member')) {
        return {
          rows: [{ id: '77777777-7777-4777-8777-777777777777' }],
          rowCount: 1
        }
      }
      if (sql.includes('FROM cloud_wallet_account')) {
        return {
          rows: [
            {
              id: cloudWalletId,
              tenant_id: '33333333-3333-4333-8333-333333333333',
              store_id: '44444444-4444-4444-8444-444444444444',
              member_id: '77777777-7777-4777-8777-777777777777',
              principal_balance_fen: 80_000,
              gift_balance_fen: 7_000
            }
          ],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 0 }
    })
    const client = { query } as unknown as PoolClient
    const callbacks = support()

    const result = await processFinancialSyncOperation(
      client,
      operation('wallet.debited', localWalletId, {
        action: 'wallet.debited',
        before: {
          accountId: localWalletId,
          memberId: '77777777-7777-4777-8777-777777777777',
          principalBalanceFen: 50_000,
          giftBalanceFen: 5_000,
          totalBalanceFen: 55_000,
          status: 'active',
          updatedAt: '2026-06-12T00:00:00.000Z'
        },
        after: {
          operationId: 'local-debit-1',
          wallet: {
            accountId: localWalletId,
            memberId: '77777777-7777-4777-8777-777777777777',
            principalBalanceFen: 45_000,
            giftBalanceFen: 0,
            totalBalanceFen: 45_000,
            status: 'active',
            updatedAt: '2026-06-13T00:00:00.000Z'
          },
          principalDeltaFen: -5_000,
          giftDeltaFen: -5_000
        },
        reason: 'offline debit'
      }),
      callbacks.value
    )

    expect(result).toBe('confirmed')
    const accountWrite = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO cloud_wallet_account')
    )
    expect(accountWrite?.[1]?.[0]).toBe(cloudWalletId)
    expect(accountWrite?.[1]?.[5]).toBe(75_000)
    expect(accountWrite?.[1]?.[6]).toBe(2_000)
  })

  it('serializes and confirms a valid expired-card manual extension', async () => {
    const cardId = '88888888-8888-4888-8888-888888888888'
    const memberId = '77777777-7777-4777-8777-777777777777'
    const before = {
      id: cardId,
      memberId,
      planName: '30 day card',
      priceFen: 20_000,
      paymentMethod: 'cash' as const,
      status: 'expired' as const,
      purchasedAt: '2026-05-01T00:00:00.000Z',
      startsAt: '2026-05-01T00:00:00.000Z',
      expiresAt: '2026-06-10T00:00:00.000Z',
      pausedAt: null,
      usageCount: 0,
      scopeType: 'store' as const,
      issuingStoreId: '44444444-4444-4444-8444-444444444444'
    }
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM cloud_employee employee')) {
        return { rows: [{ '?column?': 1 }], rowCount: 1 }
      }
      if (sql.includes('FROM cloud_monthly_card WHERE id')) {
        return {
          rows: [{
            tenant_id: '33333333-3333-4333-8333-333333333333',
            store_id: before.issuingStoreId,
            member_id: memberId,
            status: 'expired',
            usage_count: 0,
            expires_at: before.expiresAt,
            scope_type: 'store'
          }],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 0 }
    })
    const client = { query } as unknown as PoolClient
    const callbacks = support()
    const result = await processFinancialSyncOperation(
      client,
      operation('monthly_card.manual_extended', cardId, {
        action: 'monthly_card.manual_extended',
        before,
        after: {
          ...before,
          status: 'active',
          expiresAt: '2026-06-23T00:00:00.000Z'
        },
        reason: 'manager compensation'
      }),
      callbacks.value
    )
    expect(result).toBe('confirmed')
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('pg_advisory_xact_lock')
    )).toBe(true)
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes('INSERT INTO cloud_monthly_card_event')
    )).toBe(true)
  })

  it('rejects a stale concurrent manual extension snapshot', async () => {
    const cardId = '88888888-8888-4888-8888-888888888888'
    const memberId = '77777777-7777-4777-8777-777777777777'
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM cloud_employee employee')) {
        return { rows: [{ '?column?': 1 }], rowCount: 1 }
      }
      if (sql.includes('FROM cloud_monthly_card WHERE id')) {
        return {
          rows: [{
            tenant_id: '33333333-3333-4333-8333-333333333333',
            store_id: '44444444-4444-4444-8444-444444444444',
            member_id: memberId,
            status: 'active',
            usage_count: 0,
            expires_at: '2026-07-01T00:00:00.000Z',
            scope_type: 'store'
          }],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 0 }
    })
    const client = { query } as unknown as PoolClient
    const callbacks = support()
    const snapshot = {
      id: cardId, memberId, planName: '30 day card', priceFen: 20_000,
      paymentMethod: 'cash', status: 'active',
      purchasedAt: '2026-05-01T00:00:00.000Z', startsAt: '2026-05-01T00:00:00.000Z',
      expiresAt: '2026-06-20T00:00:00.000Z', pausedAt: null, usageCount: 0,
      scopeType: 'store', issuingStoreId: '44444444-4444-4444-8444-444444444444'
    }
    const result = await processFinancialSyncOperation(
      client,
      operation('monthly_card.manual_extended', cardId, {
        before: snapshot,
        after: { ...snapshot, expiresAt: '2026-06-30T00:00:00.000Z' },
        reason: 'stale extension'
      }),
      callbacks.value
    )
    expect(result).toBe('conflict')
    expect(callbacks.markConflict).toHaveBeenCalledWith(
      client,
      expect.anything(),
      'monthly_card_state_conflict',
      expect.stringContaining('changed'),
      expect.anything()
    )
    expect(callbacks.appendEvent).not.toHaveBeenCalled()
  })

  it('keeps unknown financial operation names unconfirmed', async () => {
    const client = emptyClient()
    const callbacks = support()
    const result = await processFinancialSyncOperation(
      client.value,
      operation('wallet.future_operation', 'aggregate', {}),
      callbacks.value
    )
    expect(result).toBe('unsupported')
    expect(callbacks.appendEvent).not.toHaveBeenCalled()
    expect(callbacks.completeOperation).not.toHaveBeenCalled()
  })
})
