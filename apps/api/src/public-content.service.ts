import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import type {
  MiniappHomeSnapshot,
  PublicActivitySummary,
  PublicAnnouncementSummary,
  PublicBoardGameSummary,
  PublicStoreSummary
} from '@zyapp/contracts'
import type { Pool } from '@zyapp/cloud-db'
import { POSTGRES_POOL } from './infrastructure.module'

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
              allow_stored_value, allow_wechat, recharge_tiers_json
       FROM cloud_activity_campaign
       WHERE store_id = $1
         AND status = 'published'
         AND starts_at <= CURRENT_TIMESTAMP
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
    queryInput = '',
    recommendedOnly = false
  ): Promise<PublicBoardGameSummary[]> {
    const storeId = requireStoreId(storeIdInput)
    const query = queryInput.trim().slice(0, 100)
    const result = await this.pool.query<{
      id: string
      name: string
      introduction: string
      categories_json: unknown
      min_players: number
      max_players: number
      min_minutes: number | null
      max_minutes: number | null
      difficulty: PublicBoardGameSummary['difficulty']
      available: boolean
      image_url: string | null
      customer_note: string | null
    }>(
      `SELECT id, name, introduction, categories_json, min_players,
              max_players, min_minutes, max_minutes, difficulty, available,
              image_url, customer_note
       FROM cloud_board_game
       WHERE store_id = $1
         AND record_status = 'active'
         AND private = FALSE
         AND ($2 = '' OR name ILIKE '%' || $2 || '%'
              OR categories_json::text ILIKE '%' || $2 || '%')
         AND ($3 = FALSE OR recommended = TRUE)
       ORDER BY recommended DESC, available DESC, name
       LIMIT 100`,
      [storeId, query, recommendedOnly]
    )
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      introduction: row.introduction,
      categories: jsonArray<string>(row.categories_json),
      minPlayers: row.min_players,
      maxPlayers: row.max_players,
      minMinutes: row.min_minutes,
      maxMinutes: row.max_minutes,
      difficulty: row.difficulty,
      soldOut: !row.available,
      imageUrl: row.image_url,
      customerNote: row.customer_note
    }))
  }

  async getHome(storeId: string): Promise<MiniappHomeSnapshot> {
    const [store, announcements, activities, recommendedGames] =
      await Promise.all([
        this.getStore(storeId),
        this.listAnnouncements(storeId),
        this.listActivities(storeId),
        this.listGames(storeId, '', true)
      ])
    return {
      store,
      announcements,
      activities,
      recommendedGames: recommendedGames.slice(0, 8)
    }
  }
}
