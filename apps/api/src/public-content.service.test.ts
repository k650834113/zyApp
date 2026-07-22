import { describe, expect, it } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import { PublicContentService } from './public-content.service'

const storeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('public content service', () => {
  it('returns only public board-game fields and derives sold-out state', async () => {
    const pool = {
      query: async (sql: string) => {
        expect(sql).toContain("record_status = 'active'")
        expect(sql).toContain('private = FALSE')
        return {
          rows: [
            {
              id: 'game-1',
              name: 'Cascadia',
              introduction: 'Family strategy',
              categories_json: ['Family', 'Strategy'],
              min_players: 1,
              max_players: 4,
              min_minutes: 30,
              max_minutes: 45,
              difficulty: 'light',
              available: false,
              image_url: null,
              customer_note: 'Ask staff for help.',
              internal_note: 'must not leak',
              consignor_nickname: 'must not leak'
            }
          ]
        }
      }
    } as unknown as Pool
    const result = await new PublicContentService(pool).listGames(storeId)
    expect(result).toEqual([
      {
        id: 'game-1',
        name: 'Cascadia',
        introduction: 'Family strategy',
        categories: ['Family', 'Strategy'],
        minPlayers: 1,
        maxPlayers: 4,
        minMinutes: 30,
        maxMinutes: 45,
        difficulty: 'light',
        soldOut: true,
        imageUrl: null,
        customerNote: 'Ask staff for help.'
      }
    ])
    expect(JSON.stringify(result)).not.toContain('must not leak')
  })

  it('rejects malformed store ids before querying PostgreSQL', async () => {
    const pool = {
      query: async () => {
        throw new Error('query should not run')
      }
    } as unknown as Pool
    await expect(
      new PublicContentService(pool).listActivities('not-a-uuid')
    ).rejects.toThrow('storeId must be a UUID')
  })

  it('uses configured overnight hours for the public store status', async () => {
    const pool = {
      query: async () => ({
        rows: [
          {
            id: storeId,
            name: 'Night Store',
            timezone: 'Asia/Shanghai',
            address: 'Road 1',
            contact_phone: '13800138000',
            business_open_minute: 18 * 60,
            business_close_minute: 2 * 60,
            status_override: 'automatic',
            custom_status_text: null
          }
        ]
      })
    } as unknown as Pool
    const service = new PublicContentService(pool)

    await expect(
      service.getStore(storeId, new Date('2026-06-14T17:00:00.000Z'))
    ).resolves.toMatchObject({
      businessHours: '18:00-02:00',
      isOpen: true,
      address: 'Road 1',
      contactPhone: '13800138000'
    })
  })
})
