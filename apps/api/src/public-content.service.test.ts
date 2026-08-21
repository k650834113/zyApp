import { describe, expect, it } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import { PublicContentService } from './public-content.service'

const storeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const viewerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('public content service', () => {
  it('returns only playable games using current-store filters and viewer likes', async () => {
    const pool = {
      query: async (sql: string, parameters?: unknown[]) => {
        expect(sql).toContain(
          "COALESCE(config.record_status, game.record_status) = 'active'"
        )
        expect(sql).toContain(
          'COALESCE(config.private, game.private) = FALSE'
        )
        expect(sql).toContain(
          'COALESCE(config.available, game.available) = TRUE'
        )
        expect(sql).toContain(
          'COALESCE(config.quantity, game.quantity) > 0'
        )
        expect(sql).toContain(
          'COALESCE(config.missing_pieces, game.missing_pieces) = FALSE'
        )
        expect(sql).toContain('game.categories_json @>')
        expect(sql).toContain('game.min_players <=')
        expect(sql).toContain('game.max_players >=')
        expect(sql).toContain(
          'COALESCE(game.max_minutes, game.min_minutes) >='
        )
        expect(sql).toContain('game.complexity_rating BETWEEN')
        expect(sql).toContain('game.name ILIKE')
        expect(sql).not.toContain('categories_json::text ILIKE')
        expect(sql).toContain('LIMIT $')
        expect(sql).toContain('OFFSET $')
        expect(parameters).toContain(1000)
        expect(parameters).toContain(0)
        expect(parameters).toContain(viewerId)
        return {
          rows: [
            {
              id: 'game-1',
              base_game_id: null,
              name: 'Cascadia',
              introduction: 'Family strategy',
              categories_json: ['Family', 'Strategy'],
              min_players: 1,
              max_players: 4,
              min_minutes: 30,
              max_minutes: 45,
              complexity_rating: '2.3',
              metadata_source: 'bgg',
              bgg_id: 13,
              image_url: null,
              customer_note: 'Ask staff for help.',
              like_count: '7',
              liked_by_viewer: true,
              expansion_count: 0,
              internal_note: 'must not leak',
              consignor_nickname: 'must not leak'
            }
          ]
        }
      }
    } as unknown as Pool
    const result = await new PublicContentService(pool).listGames(
      storeId,
      {
        query: 'strategy',
        categories: ['Family', 'Strategy'],
        minPlayers: 2,
        maxPlayers: 4,
        minMinutes: 20,
        maxMinutes: 60,
        minComplexity: 1.5,
        maxComplexity: 3.5
      },
      viewerId
    )
    expect(result).toEqual([
      {
        id: 'game-1',
        baseGameId: null,
        expansionCount: 0,
        name: 'Cascadia',
        introduction: 'Family strategy',
        categories: ['Family', 'Strategy'],
        minPlayers: 1,
        maxPlayers: 4,
        minMinutes: 30,
        maxMinutes: 45,
        complexityRating: 2.3,
        imageUrl: null,
        customerNote: 'Ask staff for help.',
        sourceAttribution: {
          label: 'Powered by BGG',
          url: 'https://boardgamegeek.com/boardgame/13'
        },
        likeCount: 7,
        likedByViewer: true
      }
    ])
    expect(JSON.stringify(result)).not.toContain('must not leak')
    expect(JSON.stringify(result)).not.toContain('metadataSource')
    expect(JSON.stringify(result)).not.toContain('bggId')
  })

  it('shows aggregate likes but never marks an anonymous viewer as liked', async () => {
    const pool = {
      query: async () => ({
        rows: [
          {
            id: 'game-1',
            base_game_id: null,
            name: 'Cascadia',
            introduction: 'Family strategy',
            categories_json: ['Family'],
            min_players: 1,
            max_players: 4,
            min_minutes: 30,
            max_minutes: 45,
            complexity_rating: null,
            metadata_source: null,
            bgg_id: null,
            image_url: null,
            customer_note: null,
            like_count: '3',
            liked_by_viewer: true
          }
        ]
      })
    } as unknown as Pool

    await expect(
      new PublicContentService(pool).listGames(storeId, {}, null)
    ).resolves.toEqual([
      expect.objectContaining({
        complexityRating: null,
        sourceAttribution: null,
        likeCount: 3,
        likedByViewer: false
      })
    ])
  })

  it('returns frequent playable tags and range bounds without loading game cards', async () => {
    const pool = {
      query: async (sql: string) =>
        sql.includes('jsonb_array_elements_text')
          ? { rows: [{ category: '策略' }, { category: '聚会' }] }
          : {
              rows: [{
                min_players: 1,
                max_players: 12,
                min_minutes: 10,
                max_minutes: 240,
                min_complexity: '1.0',
                max_complexity: '4.5'
              }]
            }
    } as unknown as Pool

    await expect(
      new PublicContentService(pool).getGameFilterOptions(storeId)
    ).resolves.toEqual({
      categories: ['策略', '聚会'],
      playerBounds: { min: 1, max: 12 },
      minuteBounds: { min: 10, max: 240 },
      complexityBounds: { min: 1, max: 4.5 }
    })
  })

  it('requires a viewer before running a favorites query', async () => {
    const pool = {
      query: async () => {
        throw new Error('query should not run')
      }
    } as unknown as Pool

    await expect(
      new PublicContentService(pool).listGames(storeId, {}, null, {
        favoriteOnly: true
      })
    ).rejects.toThrow('Favorite games require a viewer')
  })

  it('limits favorites to likes from the current viewer and store', async () => {
    const pool = {
      query: async (sql: string, parameters?: unknown[]) => {
        expect(sql).toContain('FROM miniapp_board_game_like favorite')
        expect(sql).toContain('favorite.store_id = current_store.id')
        expect(sql).toContain('favorite.viewer_id = $2')
        expect(parameters?.[1]).toBe(viewerId)
        return { rows: [] }
      }
    } as unknown as Pool

    await expect(
      new PublicContentService(pool).listGames(storeId, {}, viewerId, {
        favoriteOnly: true
      })
    ).resolves.toEqual([])
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
