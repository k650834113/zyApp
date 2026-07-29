import { describe, expect, it } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import { resolveRechargeGiftRules } from './recharge-gift-rules'

function fakeQueryable(
  handler: (sql: string, parameters: unknown[]) => unknown[]
): Pool {
  return {
    query: async (sql: string, parameters: unknown[] = []) => {
      const rows = handler(sql, parameters)
      return { rows, rowCount: rows.length }
    }
  } as unknown as Pool
}

function templateQueryable(tiers: unknown[]): Pool {
  return fakeQueryable((sql) =>
    sql.includes('cloud_merchant_business_template')
      ? [
          {
            id: 'template-1',
            payload_json: { tiers },
            override_payload_json: null
          }
        ]
      : []
  )
}

describe('recharge gift rule resolution', () => {
  it('prefers the active store override over the merchant template', async () => {
    const queryable = fakeQueryable((sql) => {
      if (sql.includes('cloud_merchant_business_template')) {
        return [
          {
            id: 'template-1',
            payload_json: {
              tiers: [{ principalFen: 30_000, giftFen: 2_000 }]
            },
            override_payload_json: {
              tiers: [{ principalFen: 30_000, giftFen: 3_000 }]
            }
          }
        ]
      }
      return []
    })

    await expect(
      resolveRechargeGiftRules(queryable, 'tenant-1', 'store-1')
    ).resolves.toEqual([
      {
        id: 'template-1:0',
        principalFen: 30_000,
        giftFen: 3_000
      }
    ])
  })

  it('falls back to active projected tiers when no template exists', async () => {
    const queryable = fakeQueryable((sql) =>
      sql.includes('cloud_recharge_gift_tier')
        ? [
            {
              id: 'tier-500',
              principal_fen: 50_000,
              gift_fen: 5_000
            },
            {
              id: 'tier-300',
              principal_fen: 30_000,
              gift_fen: 2_000
            }
          ]
        : []
    )

    await expect(
      resolveRechargeGiftRules(queryable, 'tenant-1', 'store-1')
    ).resolves.toEqual([
      { id: 'tier-300', principalFen: 30_000, giftFen: 2_000 },
      { id: 'tier-500', principalFen: 50_000, giftFen: 5_000 }
    ])
  })

  it.each([
    [[{ principalFen: 0, giftFen: 1 }], /principalFen/],
    [[{ principalFen: 30_000, giftFen: -1 }], /giftFen/],
    [
      [
        { principalFen: 30_000, giftFen: 2_000 },
        { principalFen: 30_000, giftFen: 3_000 }
      ],
      /unique/
    ]
  ])('rejects invalid resolved template tiers', async (tiers, error) => {
    await expect(
      resolveRechargeGiftRules(
        templateQueryable(tiers),
        'tenant-1',
        'store-1'
      )
    ).rejects.toThrow(error)
  })
})
