import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import type {
  MiniappHomeSnapshot,
  PublicBoardGameFilters,
  PublicBoardGameFilterOptions,
  PublicActivitySummary,
  PublicAnnouncementSummary,
  PublicBoardGameSummary,
  PublicStoreSummary
} from '@zyapp/contracts'
import type { Pool } from '@zyapp/cloud-db'
import type { MiniappPrincipal } from './miniapp-auth'
import { POSTGRES_POOL } from './infrastructure.module'
import { normalizeBoardGameId } from './board-game-library'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type StoreRow = {
  id: string
  name: string
  timezone: string
  address: string | null
  contact_phone: string | null
  business_open_minute: number
  business_close_minute: number
  status_override: 'automatic' | 'open' | 'closed'
  custom_status_text: string | null
}

function requireStoreId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('storeId is required')
  }
  const normalized = value.trim()
  if (!UUID_PATTERN.test(normalized)) {
    throw new BadRequestException('storeId must be a UUID')
  }
  return normalized
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function localMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(
    parts.find((part) => part.type === 'minute')?.value ?? 0
  )
  return (hour % 24) * 60 + minute
}

function businessOpen(
  now: Date,
  timezone: string,
  openingMinute: number,
  closingMinute: number
): boolean {
  const current = localMinutes(now, timezone)
  return openingMinute < closingMinute
    ? current >= openingMinute && current < closingMinute
    : current >= openingMinute || current < closingMinute
}

function formatMinute(value: number): string {
  const hour = Math.floor(value / 60)
  const minute = value % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

@Injectable()
export class PublicContentService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}
  async getPricingRows(storeId:string):Promise<Array<{label:string;regular:string;member:string}>> {
    const r=await this.pool.query<{name:string;regular:string;member:string}>(`SELECT item.name,
      COALESCE(config.regular_price_fen,item.regular_price_fen) AS regular,
      COALESCE(config.advanced_price_fen,item.advanced_price_fen) AS member
      FROM store s JOIN cloud_catalog_item item ON item.tenant_id=s.tenant_id
      LEFT JOIN cloud_catalog_store_config config ON config.tenant_id=s.tenant_id AND config.store_id=s.id AND config.catalog_item_id=item.id
      WHERE s.id=$1 AND s.status='active' AND item.item_type = 'admission'
      AND COALESCE(config.status,item.status)='active' AND COALESCE(config.availability,item.availability)='available'
      ORDER BY item.name,item.id LIMIT 50`,[requireStoreId(storeId)])
    const yuan=(value:string)=>'¥'+(Number(value)/100).toFixed(2).replace(/\.00$/,'')
    return r.rows.map(row=>({label:row.name,regular:yuan(row.regular),member:yuan(row.member)}))
  }

  private async store(storeIdInput: string): Promise<StoreRow> {
    const storeId = requireStoreId(storeIdInput)
    const result = await this.pool.query<StoreRow>(
      `SELECT id, name, timezone, address, contact_phone,
              business_open_minute, business_close_minute,
              status_override, custom_status_text
       FROM store
       WHERE id = $1 AND status = 'active'
       LIMIT 1`,
      [storeId]
    )
    const store = result.rows[0]
    if (!store) throw new NotFoundException('Store was not found')
    return store
  }

  async getStore(
    storeIdInput: string,
    now = new Date()
  ): Promise<PublicStoreSummary> {
    const store = await this.store(storeIdInput)
    const scheduledOpen = businessOpen(
      now,
      store.timezone,
      store.business_open_minute,
      store.business_close_minute
    )
    const isOpen =
      store.status_override === 'open'
        ? true
        : store.status_override === 'closed'
          ? false
          : scheduledOpen
    return {
      id: store.id,
      name: store.name,
      address: store.address,
      contactPhone: store.contact_phone,
      businessHours:
        `${formatMinute(store.business_open_minute)}-` +
        formatMinute(store.business_close_minute),
      isOpen,
      statusText:
        store.custom_status_text ?? (isOpen ? '今日营业中' : '当前休息中')
    }
  }

  async listAnnouncements(
    storeIdInput: string
  ): Promise<PublicAnnouncementSummary[]> {
    const storeId = requireStoreId(storeIdInput)
    const result = await this.pool.query<{
      id: string
      title: string
      content: string
      pinned: boolean
      published_at: Date | string | null
      visible_from: Date | string
    }>(
      `SELECT id, title, content, pinned, published_at, visible_from
       FROM cloud_announcement
       WHERE store_id = $1
         AND status = 'published'
         AND visible_from <= CURRENT_TIMESTAMP
         AND (visible_until IS NULL OR visible_until > CURRENT_TIMESTAMP)
       ORDER BY pinned DESC, visible_from DESC, created_at DESC
       LIMIT 20`,
      [storeId]
    )
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      pinned: row.pinned,
      publishedAt: new Date(row.published_at ?? row.visible_from).toISOString()
    }))
  }

  async listActivities(
    storeIdInput: string
  ): Promise<PublicActivitySummary[]> {
    const storeId = requireStoreId(storeIdInput)
    const result = await this.pool.query<{
      id: string
      title: string
      summary: string
      content: string
      lottery_config?: import('@zyapp/contracts').LotteryConfig | null
      activity_type: PublicActivitySummary['activityType']
      starts_at: Date | string
      ends_at: Date | string
      pinned: boolean
      regular_price_fen: string | number | null
      advanced_price_fen: string | number | null
      allow_stored_value: boolean
      allow_wechat: boolean
      recharge_tiers_json: unknown
    }>(
      `SELECT id, title, summary, content, activity_type, starts_at, ends_at,
              pinned, regular_price_fen, advanced_price_fen,
              allow_stored_value, allow_wechat, recharge_tiers_json,
              (SELECT lottery.state_json->'config' FROM activity_lottery lottery WHERE lottery.activity_id=cloud_activity_campaign.id AND lottery.tenant_id=cloud_activity_campaign.tenant_id AND lottery.store_id=cloud_activity_campaign.store_id) AS lottery_config
       FROM cloud_activity_campaign
       WHERE store_id = $1
         AND status = 'published'
         AND ends_at > CURRENT_TIMESTAMP
       ORDER BY pinned DESC, starts_at DESC, created_at DESC
       LIMIT 50`,
      [storeId]
    )
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      content: row.content,
      lottery:row.lottery_config??null,
      activityType: row.activity_type,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      pinned: row.pinned,
      regularPriceFen:
        row.regular_price_fen === null ? null : Number(row.regular_price_fen),
      advancedPriceFen:
        row.advanced_price_fen === null
          ? null
          : Number(row.advanced_price_fen),
      allowStoredValue: row.allow_stored_value,
      allowWechat: row.allow_wechat,
      rechargeTiers: jsonArray<{
        principalFen: number
        giftFen: number
      }>(row.recharge_tiers_json).map((tier) => ({
        principalFen: Number(tier.principalFen),
        giftFen: Number(tier.giftFen)
      }))
    }))
  }

  async listGames(
    storeIdInput: string,
    filters: PublicBoardGameFilters = {},
    viewerId: string | null = null,
    options: {
      recommendedOnly?: boolean
      favoriteOnly?: boolean
      baseGamesOnly?: boolean
      gameId?: string
    } = {}
  ): Promise<PublicBoardGameSummary[]> {
    const storeId = requireStoreId(storeIdInput)
    if (options.favoriteOnly && !viewerId) {
      throw new BadRequestException('Favorite games require a viewer')
    }
    const values: unknown[] = [storeId, viewerId]
    const parameter = (value: unknown): string => {
      values.push(value)
      return `$${values.length}`
    }
    const conditions = [
      "current_store.status = 'active'",
      "COALESCE(config.record_status, game.record_status) = 'active'",
      'COALESCE(config.private, game.private) = FALSE',
      'COALESCE(config.available, game.available) = TRUE',
      'COALESCE(config.quantity, game.quantity) > 0',
      'COALESCE(config.missing_pieces, game.missing_pieces) = FALSE'
    ]
    const query = filters.query?.trim().slice(0, 100)
    if (options.gameId) conditions.push(`game.id = ${parameter(normalizeBoardGameId(options.gameId))}`)
    if (query) {
      const marker = parameter(query)
      conditions.push(`game.name ILIKE '%' || ${marker} || '%'`)
    }
    if (filters.baseGameId) {
      conditions.push(`game.base_game_id = ${parameter(filters.baseGameId)}`)
    } else if (options.baseGamesOnly) {
      conditions.push('game.base_game_id IS NULL')
    }
    if (filters.categories?.length) {
      conditions.push(
        `game.categories_json @> ${parameter(JSON.stringify(filters.categories))}::jsonb`
      )
    }
    if (filters.minPlayers !== undefined) {
      conditions.push(`game.min_players <= ${parameter(filters.minPlayers)}`)
    }
    if (filters.maxPlayers !== undefined) {
      conditions.push(`game.max_players >= ${parameter(filters.maxPlayers)}`)
    }
    if (filters.minMinutes !== undefined) {
      conditions.push(
        `(game.min_minutes IS NOT NULL AND ` +
          `COALESCE(game.max_minutes, game.min_minutes) >= ${parameter(filters.minMinutes)})`
      )
    }
    if (filters.maxMinutes !== undefined) {
      conditions.push(
        `(game.min_minutes IS NOT NULL AND ` +
          `game.min_minutes <= ${parameter(filters.maxMinutes)})`
      )
    }
    if (
      filters.minComplexity !== undefined &&
      filters.maxComplexity !== undefined
    ) {
      const minimum = parameter(filters.minComplexity)
      const maximum = parameter(filters.maxComplexity)
      conditions.push(`game.complexity_rating BETWEEN ${minimum} AND ${maximum}`)
    } else if (filters.minComplexity !== undefined) {
      conditions.push(
        `game.complexity_rating >= ${parameter(filters.minComplexity)}`
      )
    } else if (filters.maxComplexity !== undefined) {
      conditions.push(
        `game.complexity_rating <= ${parameter(filters.maxComplexity)}`
      )
    }
    if (options.recommendedOnly) {
      conditions.push(`(COALESCE(config.recommended, game.recommended) = TRUE OR EXISTS (
        SELECT 1 FROM miniapp_content_workspace recommendation_content,
          jsonb_array_elements(COALESCE(recommendation_content.published_json->'recommendationDisplays', '[]'::jsonb)) display
        WHERE recommendation_content.tenant_id = current_store.tenant_id
          AND recommendation_content.store_id = current_store.id
          AND display->>'gameId' = game.id::text
      ))`)
    }
    if (options.favoriteOnly) {
      conditions.push(
        `EXISTS (
          SELECT 1
          FROM miniapp_board_game_like favorite
          WHERE favorite.tenant_id = current_store.tenant_id
            AND favorite.store_id = current_store.id
            AND favorite.board_game_id = game.id
            AND favorite.viewer_id = $2
        )`
      )
    }
    const limit = filters.limit ?? 1000
    const offset = filters.offset ?? 0
    const orderBy =
      filters.sort === 'recent'
        ? 'game.created_at DESC, game.id'
        : filters.sort === 'mostLiked'
          ? `COALESCE(likes.like_count, 0) DESC,
             game.created_at DESC, game.id`
          : `COALESCE(game.base_game_id, game.id),
                (game.base_game_id IS NOT NULL), game.name`
    const limitMarker = parameter(limit)
    const offsetMarker = parameter(offset)
    const result = await this.pool.query<{
      id: string
      base_game_id: string | null
      name: string
      introduction: string
      categories_json: unknown
      min_players: number
      max_players: number
      min_minutes: number | null
      max_minutes: number | null
      complexity_rating: string | number | null
      metadata_source: string | null
      bgg_id: string | number | null
      image_url: string | null
      customer_note: string | null
      like_count: string | number
      liked_by_viewer: boolean | null
      expansion_count: string | number
    }>(
      `SELECT game.id, game.base_game_id, game.name, game.introduction, game.categories_json,
              game.min_players, game.max_players, game.min_minutes,
              game.max_minutes, game.complexity_rating, game.metadata_source,
              game.bgg_id, game.image_url,
              COALESCE(config.customer_note, game.customer_note) customer_note,
              COALESCE(likes.like_count, 0) like_count,
              COALESCE(likes.liked_by_viewer, FALSE) liked_by_viewer,
              (
                SELECT COUNT(*)::integer
                FROM cloud_board_game expansion
                LEFT JOIN cloud_board_game_store_config expansion_config
                  ON expansion_config.tenant_id = current_store.tenant_id
                 AND expansion_config.store_id = current_store.id
                 AND expansion_config.board_game_id = expansion.id
                WHERE expansion.tenant_id = current_store.tenant_id
                  AND expansion.base_game_id = game.id
                  AND COALESCE(expansion_config.record_status, expansion.record_status) = 'active'
                  AND COALESCE(expansion_config.private, expansion.private) = FALSE
                  AND COALESCE(expansion_config.available, expansion.available) = TRUE
                  AND COALESCE(expansion_config.quantity, expansion.quantity) > 0
                  AND COALESCE(expansion_config.missing_pieces, expansion.missing_pieces) = FALSE
              ) expansion_count
       FROM store current_store
       JOIN cloud_board_game game
         ON game.tenant_id = current_store.tenant_id
       LEFT JOIN cloud_board_game_store_config config
         ON config.tenant_id = current_store.tenant_id
        AND config.store_id = current_store.id
        AND config.board_game_id = game.id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::integer like_count,
                BOOL_OR(board_like.viewer_id = $2::uuid) liked_by_viewer
         FROM miniapp_board_game_like board_like
         WHERE board_like.tenant_id = current_store.tenant_id
           AND board_like.store_id = current_store.id
           AND board_like.board_game_id = game.id
       ) likes ON TRUE
       WHERE current_store.id = $1
         AND ${conditions.join('\n         AND ')}
       ORDER BY ${orderBy}
       LIMIT ${limitMarker}
       OFFSET ${offsetMarker}`,
      values
    )
    return result.rows.map((row) => ({
      id: row.id,
      baseGameId: row.base_game_id,
      expansionCount: Number(row.expansion_count ?? 0),
      name: row.name,
      introduction: row.introduction,
      categories: jsonArray<string>(row.categories_json),
      minPlayers: row.min_players,
      maxPlayers: row.max_players,
      minMinutes: row.min_minutes,
      maxMinutes: row.max_minutes,
      complexityRating:
        row.complexity_rating === null
          ? null
          : Number(row.complexity_rating),
      imageUrl: row.image_url,
      customerNote: row.customer_note,
      sourceAttribution:
        row.metadata_source === 'bgg' && row.bgg_id !== null
          ? {
              label: 'Powered by BGG',
              url: `https://boardgamegeek.com/boardgame/${Number(row.bgg_id)}`
            }
          : null,
      likeCount: Number(row.like_count),
      likedByViewer: viewerId === null ? false : Boolean(row.liked_by_viewer)
    }))
  }

  async getGameFilterOptions(
    storeIdInput: string
  ): Promise<PublicBoardGameFilterOptions> {
    const storeId = requireStoreId(storeIdInput)
    const playableWhere = `current_store.id = $1
         AND current_store.status = 'active'
         AND COALESCE(config.record_status, game.record_status) = 'active'
         AND COALESCE(config.private, game.private) = FALSE
         AND COALESCE(config.available, game.available) = TRUE
         AND COALESCE(config.quantity, game.quantity) > 0
         AND COALESCE(config.missing_pieces, game.missing_pieces) = FALSE
         AND game.base_game_id IS NULL`
    const [categoryResult, boundsResult] = await Promise.all([
      this.pool.query<{ category: string }>(
        `SELECT category.value category
         FROM store current_store
         JOIN cloud_board_game game
           ON game.tenant_id = current_store.tenant_id
         LEFT JOIN cloud_board_game_store_config config
           ON config.tenant_id = current_store.tenant_id
          AND config.store_id = current_store.id
          AND config.board_game_id = game.id
         CROSS JOIN LATERAL jsonb_array_elements_text(game.categories_json) category(value)
         WHERE ${playableWhere}
         GROUP BY category.value
         ORDER BY COUNT(*) DESC, category.value`,
        [storeId]
      ),
      this.pool.query<{
        min_players: string | number | null
        max_players: string | number | null
        min_minutes: string | number | null
        max_minutes: string | number | null
        min_complexity: string | number | null
        max_complexity: string | number | null
      }>(
        `SELECT MIN(game.min_players) min_players,
                MAX(game.max_players) max_players,
                MIN(game.min_minutes) min_minutes,
                MAX(COALESCE(game.max_minutes, game.min_minutes)) max_minutes,
                MIN(game.complexity_rating) min_complexity,
                MAX(game.complexity_rating) max_complexity
         FROM store current_store
         JOIN cloud_board_game game
           ON game.tenant_id = current_store.tenant_id
         LEFT JOIN cloud_board_game_store_config config
           ON config.tenant_id = current_store.tenant_id
          AND config.store_id = current_store.id
          AND config.board_game_id = game.id
         WHERE ${playableWhere}`,
        [storeId]
      )
    ])
    const bounds = boundsResult.rows[0]
    return {
      categories: categoryResult.rows.map((row) => row.category),
      playerBounds: {
        min: Number(bounds?.min_players ?? 1),
        max: Number(bounds?.max_players ?? 8)
      },
      minuteBounds: {
        min: Number(bounds?.min_minutes ?? 15),
        max: Number(bounds?.max_minutes ?? 240)
      },
      complexityBounds: {
        min: Number(bounds?.min_complexity ?? 0),
        max: Number(bounds?.max_complexity ?? 5)
      }
    }
  }

  async getGame(storeId: string, gameId: string, viewerId: string | null = null): Promise<PublicBoardGameSummary> {
    const games = await this.listGames(storeId, { limit: 1 }, viewerId, { gameId })
    if (!games[0]) throw new NotFoundException('该游戏已下架或暂不可用')
    return games[0]
  }

  listFavoriteGames(
    principal: Pick<MiniappPrincipal, 'storeId' | 'identityId'>,
    filters:PublicBoardGameFilters={limit:24}
  ): Promise<PublicBoardGameSummary[]> {
    return this.listGames(principal.storeId, filters, principal.identityId, {
      favoriteOnly: true
    })
  }

  async getPublishedContent(storeId:string):Promise<MiniappHomeSnapshot['content']> {
    const r=await this.pool.query<{published_json:MiniappHomeSnapshot['content']}>(`SELECT content.published_json FROM miniapp_content_workspace content
      JOIN store ON store.id=content.store_id AND store.tenant_id=content.tenant_id
      WHERE content.store_id=$1 AND store.status='active'`,[requireStoreId(storeId)])
    return r.rows[0]?.published_json??null
  }
  decorateActivities(items:PublicActivitySummary[],content:MiniappHomeSnapshot['content']):PublicActivitySummary[] {
    return items.map(item=>{const display=content?.activityDisplays?.find(r=>r.activityId===item.id)
      return display?{...item,coverUrl:display.coverUrl ?? null,posterUrl:display.posterUrl,locationText:display.locationText,tags:display.tags}:item})
  }

  async getHome(storeId: string): Promise<MiniappHomeSnapshot> {
    const [store, announcements, activities, recommendedGames, contentResult] =
      await Promise.all([
        this.getStore(storeId),
        this.listAnnouncements(storeId),
        this.listActivities(storeId),
        this.listGames(storeId, {}, null, {
          recommendedOnly: true,
          baseGamesOnly: true
        }),
        this.pool.query<{published_json: MiniappHomeSnapshot['content']}>(
          `SELECT content.published_json FROM miniapp_content_workspace content
           JOIN store ON store.id = content.store_id AND store.tenant_id = content.tenant_id
           WHERE content.store_id = $1 AND store.status = 'active'`,
          [requireStoreId(storeId)]
        )
      ])
    const content=contentResult.rows[0]?.published_json ?? null
    return {
      content,
      store,
      announcements,
      activities:this.decorateActivities(activities,content),
      recommendedGames: recommendedGames.map(game=>{
        const display=content?.recommendationDisplays?.find(r=>r.gameId===game.id)
        return display?{...game,recommendationReason:display.reason,recommendationAudience:display.audience,recommendationBadge:display.badge,recommendationSceneIds:display.sceneIds}:game
      })
    }
  }
}
