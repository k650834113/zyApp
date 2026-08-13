import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable
} from '@nestjs/common'
import type {
  CloudMirrorPage,
  CloudMirrorResource
} from '@zyapp/contracts'
import type { Pool } from '@zyapp/cloud-db'
import type { DevicePrincipal } from './device-auth'
import { POSTGRES_POOL } from './infrastructure.module'

const TABLES: Record<
  CloudMirrorResource,
  { table: string; idColumn: 'id' | 'operation_id' }
> = {
  store: { table: 'store', idColumn: 'id' },
  employees: { table: 'cloud_employee', idColumn: 'id' },
  members: { table: 'cloud_member', idColumn: 'id' },
  catalog: { table: 'cloud_catalog_item', idColumn: 'id' },
  activities: { table: 'cloud_activity_campaign', idColumn: 'id' },
  announcements: { table: 'cloud_announcement', idColumn: 'id' },
  board_games: { table: 'cloud_board_game', idColumn: 'id' },
  wallet_accounts: { table: 'cloud_wallet_account', idColumn: 'id' },
  wallet_ledger: {
    table: 'cloud_wallet_ledger',
    idColumn: 'operation_id'
  },
  monthly_cards: { table: 'cloud_monthly_card', idColumn: 'id' },
  monthly_card_events: {
    table: 'cloud_monthly_card_event',
    idColumn: 'operation_id'
  },
  monthly_card_payment_orders: {
    table: 'wechat_monthly_card_order',
    idColumn: 'id'
  },
  wechat_recharge_orders: {
    table: 'wechat_recharge_order',
    idColumn: 'id'
  },
  business_templates: {
    table: 'cloud_merchant_business_template',
    idColumn: 'id'
  },
  orders: { table: 'cloud_sales_order', idColumn: 'id' },
  order_items: { table: 'cloud_sales_order_item', idColumn: 'id' },
  refunds: { table: 'cloud_refund_request', idColumn: 'id' },
  refund_events: {
    table: 'cloud_refund_event',
    idColumn: 'operation_id'
  },
  financial_refunds: {
    table: 'cloud_financial_refund_request',
    idColumn: 'id'
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/i

function resource(value: string): CloudMirrorResource {
  if (!(value in TABLES)) {
    throw new BadRequestException('Unsupported desktop mirror resource')
  }
  return value as CloudMirrorResource
}

function limit(value: string | undefined): number {
  const parsed = Number(value ?? '200')
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new BadRequestException('limit must be between 1 and 500')
  }
  return parsed
}

@Injectable()
export class DesktopMirrorService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async page(
    principal: DevicePrincipal,
    rawResource: string,
    after: string | undefined,
    rawLimit: string | undefined
  ): Promise<CloudMirrorPage> {
    const selected = resource(rawResource)
    const selectedLimit = limit(rawLimit)
    if (after !== undefined && (after.length < 1 || after.length > 120)) {
      throw new BadRequestException('after cursor is invalid')
    }
    const { table, idColumn } = TABLES[selected]
    const modelSource = selected === 'employees'
      ? `(SELECT employee.id, employee.tenant_id, access.store_id,
                 employee.username, employee.display_name, access.role,
                 CASE WHEN employee.status = 'disabled' THEN 'disabled'
                      ELSE access.status END status,
                 access.authorization_version server_version,
                 employee.created_at,
                 GREATEST(employee.updated_at, access.updated_at) updated_at
          FROM cloud_employee employee
          JOIN cloud_employee_store_access access
            ON access.employee_id = employee.id
           AND access.tenant_id = employee.tenant_id)`
      : selected === 'monthly_card_events'
        ? `(SELECT event.* FROM cloud_monthly_card_event event
            JOIN cloud_monthly_card card
              ON card.id = event.card_id AND card.tenant_id = event.tenant_id
            WHERE card.scope_type = 'tenant' OR card.store_id = $2)`
        : selected === 'wechat_recharge_orders'
          ? `(SELECT recharge.*,
                     ledger.operation_id wallet_operation_id
              FROM wechat_recharge_order recharge
              LEFT JOIN cloud_wallet_ledger ledger
                ON ledger.tenant_id = recharge.tenant_id
               AND ledger.source_operation_id = recharge.id::text
               AND ledger.event_type = 'wallet.wechat_recharged')`
        : selected === 'catalog'
          ? `(SELECT item.id, item.tenant_id, $2::uuid store_id,
                     item.code, item.name, item.item_type,
                     COALESCE(config.regular_price_fen, item.regular_price_fen) regular_price_fen,
                     COALESCE(config.advanced_price_fen, item.advanced_price_fen) advanced_price_fen,
                     COALESCE(config.status, item.status) status,
                     COALESCE(config.availability, item.availability) availability,
                     COALESCE(config.note, item.note) note,
                     item.server_version, item.created_at,
                     GREATEST(item.updated_at, COALESCE(config.updated_at, item.updated_at)) updated_at
              FROM cloud_catalog_item item
              LEFT JOIN cloud_catalog_store_config config
                ON config.tenant_id = item.tenant_id
               AND config.store_id = $2
               AND config.catalog_item_id = item.id)`
        : selected === 'board_games'
          ? `(SELECT game.id, game.tenant_id, $2::uuid store_id,
                     game.base_game_id, game.name, game.introduction, game.categories_json,
                     game.min_players, game.max_players, game.min_minutes,
                     game.max_minutes, game.difficulty,
                     game.complexity_rating,
                     COALESCE(config.quantity, game.quantity) quantity,
                     COALESCE(config.record_status, game.record_status) record_status,
                     COALESCE(config.available, game.available) available,
                     COALESCE(config.customer_consigned, game.customer_consigned) customer_consigned,
                     COALESCE(config.missing_pieces, game.missing_pieces) missing_pieces,
                     COALESCE(config.private, game.private) private,
                     COALESCE(config.recommended, game.recommended) recommended,
                     game.image_url, game.bgg_id, game.metadata_source,
                     game.metadata_imported_at,
                     COALESCE(config.customer_note, game.customer_note) customer_note,
                     COALESCE(config.internal_note, game.internal_note) internal_note,
                     COALESCE(config.consignor_nickname, game.consignor_nickname) consignor_nickname,
                     COALESCE(config.missing_parts_json, game.missing_parts_json) missing_parts_json,
                     game.server_version, game.created_at,
                     GREATEST(game.updated_at, COALESCE(config.updated_at, game.updated_at)) updated_at
              FROM cloud_board_game game
              LEFT JOIN cloud_board_game_store_config config
                ON config.tenant_id = game.tenant_id
               AND config.store_id = $2
               AND config.board_game_id = game.id)`
        : selected === 'business_templates'
          ? `(SELECT template.*,
                     override.id override_id,
                     override.payload_json override_payload_json,
                     override.active override_active,
                     override.created_at override_created_at,
                     override.updated_at override_updated_at
              FROM cloud_merchant_business_template template
              LEFT JOIN cloud_store_business_template_override override
                ON override.template_id = template.id
               AND override.tenant_id = template.tenant_id
               AND override.store_id = $2)`
          : table
    const scope =
      selected === 'store'
        ? 'model.tenant_id = $1'
        : selected === 'business_templates' || selected === 'catalog' || selected === 'board_games'
          ? 'model.tenant_id = $1'
        : [
            'members', 'wallet_accounts', 'wallet_ledger', 'orders',
            'order_items', 'refunds', 'refund_events', 'financial_refunds',
            'wechat_recharge_orders', 'monthly_card_payment_orders'
          ].includes(selected)
          ? 'model.tenant_id = $1'
          : selected === 'monthly_cards'
            ? "model.tenant_id = $1 AND (model.scope_type = 'tenant' OR model.store_id = $2)"
            : selected === 'monthly_card_events'
              ? 'model.tenant_id = $1'
              : 'model.tenant_id = $1 AND model.store_id = $2'
    const rows = await this.pool.query<{
      id: string
      payload: Record<string, unknown>
    }>(
      `SELECT model.${idColumn}::text id, row_to_json(model) payload
       FROM ${modelSource} model
       WHERE ${scope}
         AND $2::uuid IS NOT NULL
         AND ($3::text IS NULL OR model.${idColumn}::text > $3)
       ORDER BY model.${idColumn}::text
       LIMIT $4::integer`,
      [
        principal.tenantId,
        principal.storeId,
        after ?? null,
        selectedLimit + 1
      ]
    )
    const tenantWide = [
      'members',
      'wallet_accounts',
      'wallet_ledger',
      'monthly_cards',
      'monthly_card_events'
      ,'monthly_card_payment_orders'
      ,'wechat_recharge_orders'
      ,'store', 'orders', 'order_items', 'refunds', 'refund_events', 'financial_refunds'
      ,'business_templates'
      ,'catalog'
      ,'board_games'
    ].includes(selected)
    const event = await this.pool.query<{ sequence: string | number }>(
      `SELECT COALESCE(MAX(sequence), 0) sequence FROM cloud_event
       WHERE tenant_id = $1${tenantWide ? ' AND $2::uuid IS NOT NULL' : ' AND store_id = $2'}`,
      [principal.tenantId, principal.storeId]
    )
    const hasMore = rows.rows.length > selectedLimit
    const pageRows = rows.rows.slice(0, selectedLimit)
    return {
      resource: selected,
      rows: pageRows,
      nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null,
      eventCursor: String(event.rows[0]?.sequence ?? 0),
      serverTime: new Date().toISOString()
    }
  }

  async activateEmptyEpoch(
    principal: DevicePrincipal,
    body: unknown
  ): Promise<{
    epochId: string
    activatedAt: string
    firstBusinessWriteAt: string | null
  }> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('cutover body must be an object')
    }
    const input = body as Record<string, unknown>
    if (typeof input.epochId !== 'string' || !UUID_PATTERN.test(input.epochId)) {
      throw new BadRequestException('epochId must be a UUID')
    }
    if (
      typeof input.archiveSha256 !== 'string' ||
      !SHA256_PATTERN.test(input.archiveSha256)
    ) {
      throw new BadRequestException('archiveSha256 must be SHA-256')
    }
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const device = await client.query(
        `SELECT id FROM device WHERE id = $1 AND tenant_id = $2
           AND store_id = $3 AND status = 'active' FOR UPDATE`,
        [principal.deviceId, principal.tenantId, principal.storeId]
      )
      if (device.rowCount !== 1) {
        throw new ConflictException('Device is no longer active')
      }
      const existing = await client.query<{
        epoch_id: string
        activated_at: Date
        first_business_write_at: Date | null
      }>(
        `SELECT epoch_id, activated_at, first_business_write_at
         FROM cloud_mirror_epoch
         WHERE tenant_id = $1 AND store_id = $2 FOR UPDATE`,
        [principal.tenantId, principal.storeId]
      )
      const current = existing.rows[0]
      if (current) {
        await client.query('COMMIT')
        return {
          epochId: current.epoch_id,
          activatedAt: current.activated_at.toISOString(),
          firstBusinessWriteAt:
            current.first_business_write_at?.toISOString() ?? null
        }
      }
      const counts = await client.query<{ count: string | number }>(
        `SELECT
           (SELECT COUNT(*) FROM cloud_member WHERE tenant_id = $1 AND store_id = $2) +
           (SELECT COUNT(*) FROM cloud_wallet_ledger WHERE tenant_id = $1 AND store_id = $2) +
           (SELECT COUNT(*) FROM cloud_monthly_card WHERE tenant_id = $1 AND store_id = $2) +
           (SELECT COUNT(*) FROM cloud_sales_order WHERE tenant_id = $1 AND store_id = $2) +
           (SELECT COUNT(*) FROM cloud_refund_request WHERE tenant_id = $1 AND store_id = $2) +
           (SELECT COUNT(*) FROM cloud_financial_refund_request WHERE tenant_id = $1 AND store_id = $2)
           AS count`,
        [principal.tenantId, principal.storeId]
      )
      if (Number(counts.rows[0]?.count ?? 0) !== 0) {
        throw new ConflictException('Cloud business database is not empty')
      }
      await client.query(
        `DELETE FROM sync_conflict WHERE tenant_id = $1 AND store_id = $2`,
        [principal.tenantId, principal.storeId]
      )
      await client.query(
        `DELETE FROM sync_operation WHERE tenant_id = $1 AND store_id = $2`,
        [principal.tenantId, principal.storeId]
      )
      await client.query(
        `DELETE FROM cloud_event WHERE tenant_id = $1 AND store_id = $2`,
        [principal.tenantId, principal.storeId]
      )
      await client.query(
        `UPDATE device SET last_device_seq = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [principal.deviceId]
      )
      const inserted = await client.query<{
        epoch_id: string
        activated_at: Date
        first_business_write_at: Date | null
      }>(
        `INSERT INTO cloud_mirror_epoch
         (tenant_id, store_id, initiated_by_device_id, epoch_id,
          archived_local_sha256)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, store_id) DO NOTHING
         RETURNING epoch_id, activated_at, first_business_write_at`,
        [
          principal.tenantId,
          principal.storeId,
          principal.deviceId,
          input.epochId,
          input.archiveSha256.toLowerCase()
        ]
      )
      await client.query('COMMIT')
      const row = inserted.rows[0]
      if (!row) throw new Error('Cloud mirror epoch was not created')
      return {
        epochId: row.epoch_id,
        activatedAt: row.activated_at.toISOString(),
        firstBusinessWriteAt: null
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async currentEpoch(principal: DevicePrincipal): Promise<{
    epochId: string
    activatedAt: string
    firstBusinessWriteAt: string | null
  } | null> {
    const result = await this.pool.query<{
      epoch_id: string
      activated_at: Date
      first_business_write_at: Date | null
    }>(
      `SELECT epoch_id, activated_at, first_business_write_at
       FROM cloud_mirror_epoch WHERE tenant_id = $1 AND store_id = $2`,
      [principal.tenantId, principal.storeId]
    )
    const row = result.rows[0]
    return row
      ? {
          epochId: row.epoch_id,
          activatedAt: row.activated_at.toISOString(),
          firstBusinessWriteAt: row.first_business_write_at?.toISOString() ?? null
        }
      : null
  }
}
