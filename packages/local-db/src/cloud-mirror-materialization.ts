import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CloudMirrorPage } from '@zyapp/contracts'
import type { StoreContext } from './identity'
import { reconcileProjectedMemberTier } from './member-tier-projection'

type Json = Record<string, unknown>

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Cloud mirror ${field} is invalid`)
  }
  return value
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function enumText<const T extends string>(
  value: string,
  allowed: readonly T[],
  field: string
): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`Cloud mirror ${field} is invalid`)
  }
  return value as T
}

function integer(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Cloud mirror ${field} is invalid`)
  }
  return parsed
}

function complexityTenths(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  const tenths = Math.round(parsed * 10)
  if (
    !Number.isFinite(parsed) ||
    tenths < 0 ||
    tenths > 50 ||
    Math.abs(parsed - tenths / 10) > 1e-9
  ) {
    throw new Error(`Cloud mirror ${field} is invalid`)
  }
  return tenths
}

function metadataSource(value: unknown): 'bgg' | null {
  if (value === null || value === undefined || value === '') return null
  if (value !== 'bgg') {
    throw new Error('Cloud mirror board_game.metadata_source is invalid')
  }
  return value
}

function nullableTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Cloud mirror ${field} is invalid`)
  }
  return new Date(value).toISOString()
}

function bool(value: unknown): number {
  return value === true || value === 1 ? 1 : 0
}

function json(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback)
}

function hasPendingAggregate(
  database: DatabaseSync,
  context: StoreContext,
  aggregateId: string
): boolean {
  return Boolean(database.prepare(
    `SELECT 1 FROM outbox_operation
     WHERE tenant_id = ? AND store_id = ? AND aggregate_id = ?
       AND sync_status <> 'confirmed'
       AND NOT EXISTS (SELECT 1 FROM cloud_financial_command command
         WHERE command.group_id = json_extract(outbox_operation.payload_json, '$.atomicGroup.id')
           AND command.device_id = outbox_operation.device_id) LIMIT 1`
  ).get(context.tenantId, context.storeId, aggregateId))
}

function managerId(database: DatabaseSync, context: StoreContext): string {
  const row = database.prepare(
    `SELECT id FROM employee WHERE tenant_id = ? AND role = 'manager'
     ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at LIMIT 1`
  ).get(context.tenantId) as { id: string } | undefined
  return row?.id ?? 'cloud-sync'
}

function applyStore(database: DatabaseSync, context: StoreContext, row: Json): void {
  const id = text(row.id, 'store.id')
  database.prepare(
    `INSERT INTO store
     (id, tenant_id, name, timezone, address, contact_phone,
      business_open_minute, business_close_minute, status_override,
      custom_status_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name, timezone = excluded.timezone,
       address = excluded.address, contact_phone = excluded.contact_phone,
       business_open_minute = excluded.business_open_minute,
       business_close_minute = excluded.business_close_minute,
       status_override = excluded.status_override,
       custom_status_text = excluded.custom_status_text,
       updated_at = excluded.updated_at
     WHERE store.tenant_id = excluded.tenant_id`
  ).run(
    id,
    context.tenantId,
    text(row.name, 'store.name'),
    nullableText(row.timezone) ?? 'Asia/Shanghai',
    nullableText(row.address),
    nullableText(row.contact_phone),
    integer(row.business_open_minute ?? 780, 'store.business_open_minute'),
    integer(row.business_close_minute ?? 1380, 'store.business_close_minute'),
    nullableText(row.status_override) ?? 'automatic',
    nullableText(row.custom_status_text),
    text(row.created_at, 'store.created_at'),
    text(row.updated_at, 'store.updated_at')
  )
}

function applyEmployee(database: DatabaseSync, context: StoreContext, row: Json): void {
  const id = text(row.id, 'employee.id')
  if (hasPendingAggregate(database, context, id)) return
  database.prepare(
    `INSERT INTO employee
     (id, tenant_id, store_id, username, password_hash, display_name, role,
      status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'cloud-login-not-configured', ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       username = excluded.username, display_name = excluded.display_name,
       role = excluded.role, status = excluded.status,
       updated_at = excluded.updated_at
     WHERE employee.tenant_id = excluded.tenant_id
       AND employee.store_id = excluded.store_id`
  ).run(
    id,
    context.tenantId,
    context.storeId,
    text(row.username, 'employee.username'),
    text(row.display_name, 'employee.display_name'),
    text(row.role, 'employee.role'),
    text(row.status, 'employee.status'),
    text(row.created_at, 'employee.created_at'),
    text(row.updated_at, 'employee.updated_at')
  )
  const serverVersion = integer(row.server_version ?? 0, 'employee.server_version')
  const status = text(row.status, 'employee.status')
  database.prepare(
    `UPDATE employee_pc_offline_credential
     SET invalidated_at = CASE
           WHEN ? = 'disabled' OR authorization_version < ?
             THEN COALESCE(invalidated_at, ?)
           ELSE invalidated_at
         END,
         updated_at = ?
     WHERE employee_id = ? AND tenant_id = ? AND store_id = ? AND device_id = ?`
  ).run(
    status,
    serverVersion,
    text(row.updated_at, 'employee.updated_at'),
    text(row.updated_at, 'employee.updated_at'),
    id,
    context.tenantId,
    context.storeId,
    context.deviceId
  )
}

function applyMember(database: DatabaseSync, context: StoreContext, row: Json): void {
  const id = text(row.id, 'member.id')
  const sourceStoreId = nullableText(row.store_id) ?? context.storeId
  if (hasPendingAggregate(database, context, id)) return
  const ageGate = nullableText(row.age_gate_status) ?? 'confirmed_at_least_14'
  database.prepare(
    `INSERT INTO member
     (id, tenant_id, store_id, member_number, phone, nickname, status,
      birthday_month, birthday_day, birthday_source, birthday_locked,
      confirmed_at_least_14, age_gate_status, note, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       member_number = excluded.member_number, phone = excluded.phone,
       nickname = excluded.nickname, status = excluded.status,
       birthday_month = excluded.birthday_month,
       birthday_day = excluded.birthday_day,
       birthday_source = excluded.birthday_source,
       birthday_locked = excluded.birthday_locked,
       confirmed_at_least_14 = excluded.confirmed_at_least_14,
       age_gate_status = excluded.age_gate_status, note = excluded.note,
       source = excluded.source, updated_at = excluded.updated_at
     WHERE member.tenant_id = excluded.tenant_id`
  ).run(
    id, context.tenantId, sourceStoreId,
    text(row.member_number, 'member.member_number'),
    text(row.phone, 'member.phone'),
    text(row.nickname, 'member.nickname'),
    text(row.status, 'member.status'),
    row.birthday_month === null ? null : integer(row.birthday_month, 'member.birthday_month'),
    row.birthday_day === null ? null : integer(row.birthday_day, 'member.birthday_day'),
    nullableText(row.birthday_source),
    row.birthday_month === null ? 0 : 1,
    ageGate === 'confirmed_at_least_14' ? 1 : 0,
    ageGate,
    nullableText(row.note),
    nullableText(row.source) ?? 'desktop',
    text(row.created_at, 'member.created_at'),
    text(row.updated_at, 'member.updated_at')
  )
  reconcileProjectedMemberTier(database, context, {
    memberId: id,
    sourceStoreId,
    tier: row.tier === 'advanced' ? 'advanced' : 'ordinary',
    source: nullableText(row.source) ?? 'desktop',
    occurredAt: text(row.updated_at, 'member.updated_at')
  })
}

function applyCatalog(database: DatabaseSync, context: StoreContext, row: Json): void {
  const id = text(row.id, 'catalog.id')
  if (hasPendingAggregate(database, context, id)) return
  database.prepare(
    `INSERT INTO catalog_item
     (id, tenant_id, store_id, code, name, item_type, regular_price_fen,
      advanced_price_fen, status, availability, note, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'desktop', ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       code = excluded.code, name = excluded.name, item_type = excluded.item_type,
       regular_price_fen = excluded.regular_price_fen,
       advanced_price_fen = excluded.advanced_price_fen,
       status = excluded.status, availability = excluded.availability,
       note = excluded.note, updated_at = excluded.updated_at
     WHERE catalog_item.tenant_id = excluded.tenant_id
    `
  ).run(
    id, context.tenantId, context.storeId,
    text(row.code, 'catalog.code'), text(row.name, 'catalog.name'),
    text(row.item_type, 'catalog.item_type'),
    integer(row.regular_price_fen, 'catalog.regular_price_fen'),
    integer(row.advanced_price_fen, 'catalog.advanced_price_fen'),
    text(row.status, 'catalog.status'),
    text(row.availability, 'catalog.availability'),
    nullableText(row.note), text(row.created_at, 'catalog.created_at'),
    text(row.updated_at, 'catalog.updated_at')
  )
  database.prepare(
    `INSERT INTO catalog_store_config
     (tenant_id, store_id, catalog_item_id, regular_price_fen,
      advanced_price_fen, status, availability, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, store_id, catalog_item_id) DO UPDATE SET
       regular_price_fen = excluded.regular_price_fen,
       advanced_price_fen = excluded.advanced_price_fen,
       status = excluded.status, availability = excluded.availability,
       note = excluded.note, updated_at = excluded.updated_at`
  ).run(
    context.tenantId, context.storeId, id,
    integer(row.regular_price_fen, 'catalog.regular_price_fen'),
    integer(row.advanced_price_fen, 'catalog.advanced_price_fen'),
    text(row.status, 'catalog.status'), text(row.availability, 'catalog.availability'),
    nullableText(row.note), text(row.updated_at, 'catalog.updated_at')
  )
}

function applyActivity(database: DatabaseSync, context: StoreContext, row: Json): void {
  const id = text(row.id, 'activity.id')
  if (hasPendingAggregate(database, context, id)) return
  const actor = managerId(database, context)
  database.prepare(
    `INSERT INTO activity_campaign
     (id, tenant_id, store_id, title, summary, content, activity_type, status,
      starts_at, ends_at, pinned, regular_price_fen, advanced_price_fen,
      allow_stored_value, allow_wechat, created_by, published_by, published_at,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title, summary = excluded.summary, content = excluded.content,
       activity_type = excluded.activity_type, status = excluded.status,
       starts_at = excluded.starts_at, ends_at = excluded.ends_at,
       pinned = excluded.pinned, regular_price_fen = excluded.regular_price_fen,
       advanced_price_fen = excluded.advanced_price_fen,
       allow_stored_value = excluded.allow_stored_value,
       allow_wechat = excluded.allow_wechat, published_at = excluded.published_at,
       updated_at = excluded.updated_at`
  ).run(
    id, context.tenantId, context.storeId,
    text(row.title, 'activity.title'), text(row.summary, 'activity.summary'),
    text(row.content, 'activity.content'), text(row.activity_type, 'activity.activity_type'),
    text(row.status, 'activity.status'), text(row.starts_at, 'activity.starts_at'),
    text(row.ends_at, 'activity.ends_at'), bool(row.pinned),
    row.regular_price_fen === null ? null : integer(row.regular_price_fen, 'activity.regular_price_fen'),
    row.advanced_price_fen === null ? null : integer(row.advanced_price_fen, 'activity.advanced_price_fen'),
    bool(row.allow_stored_value), bool(row.allow_wechat), actor,
    row.status === 'published' ? actor : null,
    nullableText(row.published_at), text(row.created_at, 'activity.created_at'),
    text(row.updated_at, 'activity.updated_at')
  )
  database.prepare('DELETE FROM activity_recharge_tier WHERE tenant_id = ? AND activity_id = ?')
    .run(context.tenantId, id)
  const tiers = Array.isArray(row.recharge_tiers_json) ? row.recharge_tiers_json : []
  const insert = database.prepare(
    `INSERT INTO activity_recharge_tier
     (id, tenant_id, store_id, activity_id, principal_fen, gift_fen, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const value of tiers) {
    if (!value || typeof value !== 'object') continue
    const tier = value as Json
    insert.run(
      nullableText(tier.id) ?? randomUUID(), context.tenantId, context.storeId, id,
      integer(tier.principalFen ?? tier.principal_fen, 'activity.tier.principal'),
      integer(tier.giftFen ?? tier.gift_fen, 'activity.tier.gift'),
      text(row.updated_at, 'activity.updated_at')
    )
  }
}

function applyAnnouncement(database: DatabaseSync, context: StoreContext, row: Json): void {
  const id = text(row.id, 'announcement.id')
  if (hasPendingAggregate(database, context, id)) return
  const actor = managerId(database, context)
  database.prepare(
    `INSERT INTO announcement
     (id, tenant_id, store_id, title, content, status, pinned, visible_from,
      visible_until, created_by, published_by, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title, content = excluded.content, status = excluded.status,
       pinned = excluded.pinned, visible_from = excluded.visible_from,
       visible_until = excluded.visible_until, published_at = excluded.published_at,
       updated_at = excluded.updated_at`
  ).run(
    id, context.tenantId, context.storeId,
    text(row.title, 'announcement.title'), text(row.content, 'announcement.content'),
    text(row.status, 'announcement.status'), bool(row.pinned),
    text(row.visible_from, 'announcement.visible_from'), nullableText(row.visible_until),
    actor, row.status === 'published' ? actor : null, nullableText(row.published_at),
    text(row.created_at, 'announcement.created_at'), text(row.updated_at, 'announcement.updated_at')
  )
}

function applyBoardGame(database: DatabaseSync, context: StoreContext, row: Json): void {
  const id = text(row.id, 'board_game.id')
  if (hasPendingAggregate(database, context, id)) return
  database.prepare(
    `INSERT INTO board_game
     (id, tenant_id, store_id, base_game_id, name, introduction, categories_json, min_players,
      max_players, min_minutes, max_minutes, difficulty, complexity_tenths,
      quantity, record_status,
      available, customer_consigned, missing_pieces, private, recommended,
      image_url, local_image_path, bgg_id, metadata_source,
      metadata_imported_at, customer_note, internal_note, consignor_nickname,
      created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL,
             ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       base_game_id = excluded.base_game_id,
       name = excluded.name, introduction = excluded.introduction,
       categories_json = excluded.categories_json, min_players = excluded.min_players,
       max_players = excluded.max_players, min_minutes = excluded.min_minutes,
       max_minutes = excluded.max_minutes, difficulty = excluded.difficulty,
       complexity_tenths = excluded.complexity_tenths,
       quantity = excluded.quantity, record_status = excluded.record_status,
       available = excluded.available, customer_consigned = excluded.customer_consigned,
       missing_pieces = excluded.missing_pieces, private = excluded.private,
       recommended = excluded.recommended, image_url = excluded.image_url,
       bgg_id = excluded.bgg_id, metadata_source = excluded.metadata_source,
       metadata_imported_at = excluded.metadata_imported_at,
       customer_note = excluded.customer_note,
       internal_note = excluded.internal_note,
       consignor_nickname = excluded.consignor_nickname,
       updated_at = excluded.updated_at
     WHERE board_game.tenant_id = excluded.tenant_id`
  ).run(
    id, context.tenantId, context.storeId,
    nullableText(row.base_game_id),
    text(row.name, 'board_game.name'), text(row.introduction, 'board_game.introduction'),
    json(row.categories_json, []), integer(row.min_players, 'board_game.min_players'),
    integer(row.max_players, 'board_game.max_players'),
    row.min_minutes === null ? null : integer(row.min_minutes, 'board_game.min_minutes'),
    row.max_minutes === null ? null : integer(row.max_minutes, 'board_game.max_minutes'),
    text(row.difficulty, 'board_game.difficulty'),
    complexityTenths(row.complexity_rating, 'board_game.complexity_rating'),
    integer(row.quantity, 'board_game.quantity'),
    text(row.record_status, 'board_game.record_status'), bool(row.available),
    bool(row.customer_consigned), bool(row.missing_pieces), bool(row.private),
    bool(row.recommended), nullableText(row.image_url),
    row.bgg_id === null ? null : integer(row.bgg_id, 'board_game.bgg_id'),
    metadataSource(row.metadata_source),
    nullableTimestamp(row.metadata_imported_at, 'board_game.metadata_imported_at'),
    nullableText(row.customer_note), nullableText(row.internal_note),
    nullableText(row.consignor_nickname), managerId(database, context),
    text(row.created_at, 'board_game.created_at'), text(row.updated_at, 'board_game.updated_at')
  )
  database.prepare('DELETE FROM board_game_missing_part WHERE tenant_id = ? AND board_game_id = ?')
    .run(context.tenantId, id)
  const parts = Array.isArray(row.missing_parts_json) ? row.missing_parts_json : []
  const insert = database.prepare(
    `INSERT INTO board_game_missing_part
     (id, tenant_id, store_id, board_game_id, name, quantity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const value of parts) {
    if (!value || typeof value !== 'object') continue
    const part = value as Json
    insert.run(
      nullableText(part.id) ?? randomUUID(), context.tenantId, context.storeId, id,
      text(part.name, 'board_game.part.name'), integer(part.quantity, 'board_game.part.quantity'),
      text(row.updated_at, 'board_game.updated_at')
    )
  }
  database.prepare(
    `INSERT INTO board_game_store_config
     (tenant_id, store_id, board_game_id, quantity, record_status, available,
      customer_consigned, missing_pieces, private, recommended, customer_note,
      internal_note, consignor_nickname, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, store_id, board_game_id) DO UPDATE SET
       quantity = excluded.quantity, record_status = excluded.record_status,
       available = excluded.available,
       customer_consigned = excluded.customer_consigned,
       missing_pieces = excluded.missing_pieces, private = excluded.private,
       recommended = excluded.recommended, customer_note = excluded.customer_note,
       internal_note = excluded.internal_note,
       consignor_nickname = excluded.consignor_nickname,
       updated_at = excluded.updated_at`
  ).run(
    context.tenantId, context.storeId, id,
    integer(row.quantity, 'board_game.quantity'),
    text(row.record_status, 'board_game.record_status'), bool(row.available),
    bool(row.customer_consigned), bool(row.missing_pieces), bool(row.private),
    bool(row.recommended), nullableText(row.customer_note),
    nullableText(row.internal_note), nullableText(row.consignor_nickname),
    text(row.updated_at, 'board_game.updated_at')
  )
}

function applyWalletAccount(database: DatabaseSync, context: StoreContext, row: Json): void {
  const id = text(row.id, 'wallet.id')
  const sourceStoreId = nullableText(row.store_id) ?? context.storeId
  if (hasPendingAggregate(database, context, id)) return
  const principal = integer(row.principal_balance_fen, 'wallet.principal_balance_fen')
  const gift = integer(row.gift_balance_fen, 'wallet.gift_balance_fen')
  database.prepare(
    `INSERT INTO wallet_account
     (id, tenant_id, store_id, member_id, status, principal_balance_fen,
      gift_balance_fen, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = excluded.status,
       principal_balance_fen = excluded.principal_balance_fen,
       gift_balance_fen = excluded.gift_balance_fen,
       updated_at = excluded.updated_at`
  ).run(
    id, context.tenantId, sourceStoreId, text(row.member_id, 'wallet.member_id'),
    text(row.status, 'wallet.status'), principal, gift,
    text(row.created_at, 'wallet.created_at'), text(row.updated_at, 'wallet.updated_at')
  )
  const sourceId = `cloud-balance:${id}`
  const represented = database.prepare(
    `SELECT COALESCE(SUM(remaining_principal_fen), 0) principal_fen,
            COALESCE(SUM(remaining_gift_fen), 0) gift_fen
     FROM wallet_lot
     WHERE tenant_id = ? AND wallet_account_id = ?
       AND NOT (source_type = 'adjustment' AND source_id = ?)`
  ).get(context.tenantId, id, sourceId) as {
    principal_fen: number
    gift_fen: number
  }
  const residualPrincipal = Math.max(0, principal - Number(represented.principal_fen))
  const residualGift = Math.max(0, gift - Number(represented.gift_fen))
  database.prepare(
    `INSERT INTO wallet_lot
     (id, tenant_id, store_id, wallet_account_id, member_id, source_type,
      source_id, original_principal_fen, original_gift_fen,
      remaining_principal_fen, remaining_gift_fen, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'adjustment', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, source_type, source_id) DO UPDATE SET
       original_principal_fen = excluded.original_principal_fen,
       original_gift_fen = excluded.original_gift_fen,
       remaining_principal_fen = excluded.remaining_principal_fen,
       remaining_gift_fen = excluded.remaining_gift_fen,
       updated_at = excluded.updated_at`
  ).run(
    sourceId, context.tenantId, sourceStoreId, id,
    text(row.member_id, 'wallet.member_id'), sourceId,
    residualPrincipal, residualGift, residualPrincipal, residualGift,
    text(row.created_at, 'wallet.created_at'), text(row.updated_at, 'wallet.updated_at')
  )
}

function walletEntryType(eventType: string): string {
  const map: Record<string, string> = {
    'wallet.reconciled': 'manual_adjustment',
    'wallet.cash_recharged': 'cash_recharge',
    'wallet.wechat_recharged': 'wechat_recharge',
    'wallet.debited': 'consumption_debit',
    'wallet.cash_recharge_reversed': 'cash_recharge_reversal',
    'wallet.order_refund_credited': 'order_refund_credit'
  }
  return map[eventType] ?? 'manual_adjustment'
}

function applyWalletLedger(database: DatabaseSync, context: StoreContext, row: Json): void {
  const operationId = text(row.operation_id, 'wallet_ledger.operation_id')
  if (database.prepare('SELECT 1 FROM wallet_ledger WHERE id = ?').get(operationId)) return
  const eventType = text(row.event_type, 'wallet_ledger.event_type')
  const entryType = walletEntryType(eventType)
  const memberId = text(row.member_id, 'wallet_ledger.member_id')
  const sourceOperationId = text(row.source_operation_id, 'wallet_ledger.source_operation_id')
  const principalDeltaFen = integer(
    row.principal_delta_fen,
    'wallet_ledger.principal_delta_fen'
  )
  const giftDeltaFen = integer(row.gift_delta_fen, 'wallet_ledger.gift_delta_fen')
  if (
    database.prepare(
      `SELECT 1
       FROM wallet_ledger
       WHERE tenant_id = ?
         AND member_id = ?
         AND entry_type = ?
         AND source_id = ?
         AND principal_delta_fen = ?
         AND gift_delta_fen = ?
         AND actor_id <> 'cloud-sync'
       LIMIT 1`
    ).get(
      context.tenantId,
      memberId,
      entryType,
      sourceOperationId,
      principalDeltaFen,
      giftDeltaFen
    )
  ) return
  const occurrenceStoreId = nullableText(row.store_id) ?? context.storeId
  database.prepare(
    `INSERT INTO wallet_ledger
     (id, tenant_id, store_id, wallet_account_id, member_id, entry_type,
      principal_delta_fen, gift_delta_fen, principal_balance_after_fen,
      gift_balance_after_fen, source_id, related_ledger_id, request_id,
      actor_id, device_id, reason, metadata_json, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'cloud-sync', ?, ?, ?, ?)`
  ).run(
    operationId, context.tenantId, occurrenceStoreId,
    text(row.wallet_account_id, 'wallet_ledger.wallet_account_id'),
    memberId,
    entryType,
    principalDeltaFen,
    giftDeltaFen,
    integer(row.principal_balance_after_fen, 'wallet_ledger.principal_balance_after_fen'),
    integer(row.gift_balance_after_fen, 'wallet_ledger.gift_balance_after_fen'),
    sourceOperationId,
    `cloud:${operationId}`, context.deviceId,
    nullableText(row.reason) ?? '云端同步', json(row.payload_json, {}),
    text(row.occurred_at, 'wallet_ledger.occurred_at')
  )
  if (eventType === 'wallet.cash_recharged' || eventType === 'wallet.wechat_recharged') {
    const rechargeId = sourceOperationId
    database.prepare(
      `INSERT OR IGNORE INTO wallet_recharge
       (id, tenant_id, store_id, wallet_account_id, member_id, payment_method,
        principal_fen, gift_fen, status, gift_rule_snapshot_json, request_id,
        actor_id, device_id, reason, occurred_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, 'cloud-sync', ?, ?, ?, ?)`
    ).run(
      rechargeId,
      context.tenantId,
      occurrenceStoreId,
      text(row.wallet_account_id, 'wallet_ledger.wallet_account_id'),
      memberId,
      eventType === 'wallet.wechat_recharged' ? 'wechat' : 'cash',
      principalDeltaFen,
      giftDeltaFen,
      json(row.payload_json, {}),
      `cloud-recharge:${rechargeId}`,
      context.deviceId,
      nullableText(row.reason) ?? '云端充值同步',
      text(row.occurred_at, 'wallet_ledger.occurred_at'),
      text(row.occurred_at, 'wallet_ledger.occurred_at')
    )
  }
}

function applyMonthlyCard(database: DatabaseSync, context: StoreContext, row: Json): void {
  const id = text(row.id, 'monthly_card.id')
  const issuingStoreId = nullableText(row.store_id) ?? context.storeId
  const scopeType = nullableText(row.scope_type) === 'tenant' ? 'tenant' : 'store'
  if (hasPendingAggregate(database, context, id)) return
  let plan = database.prepare(
    `SELECT id, duration_days FROM monthly_card_plan
     WHERE tenant_id = ? AND store_id = ? AND name = ? LIMIT 1`
  ).get(context.tenantId, issuingStoreId, text(row.plan_name, 'monthly_card.plan_name')) as
    | { id: string; duration_days: number }
    | undefined
  if (!plan) {
    plan = { id: randomUUID(), duration_days: 30 }
    database.prepare(
      `INSERT INTO monthly_card_plan
       (id, tenant_id, store_id, name, price_fen, duration_days, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 30, 1, ?, ?)`
    ).run(
      plan.id, context.tenantId, issuingStoreId,
      text(row.plan_name, 'monthly_card.plan_name'),
      integer(row.price_fen, 'monthly_card.price_fen'),
      text(row.purchased_at, 'monthly_card.purchased_at'),
      text(row.updated_at, 'monthly_card.updated_at')
    )
  }
  database.prepare(
    `INSERT INTO monthly_card
     (id, tenant_id, store_id, member_id, plan_id, plan_name_snapshot,
      price_fen, duration_days, payment_method, status, request_id,
      purchased_by, purchased_at, starts_at, expires_at, paused_at,
      total_paused_seconds, refunded_at, refund_reason, updated_at, scope_type,
      source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cloud-sync', ?, ?, ?, ?, 0,
             ?, NULL, ?, ?, 'cloud')
     ON CONFLICT (id) DO UPDATE SET status = excluded.status,
       expires_at = excluded.expires_at, paused_at = excluded.paused_at,
       refunded_at = excluded.refunded_at,
       payment_method = excluded.payment_method,
       updated_at = excluded.updated_at, source = 'cloud'`
  ).run(
    id, context.tenantId, issuingStoreId, text(row.member_id, 'monthly_card.member_id'),
    plan.id, text(row.plan_name, 'monthly_card.plan_name'),
    integer(row.price_fen, 'monthly_card.price_fen'), plan.duration_days,
    nullableText(row.payment_method) === 'wechat' ? 'wechat' : 'cash',
    text(row.status, 'monthly_card.status'), `cloud-card:${id}`,
    text(row.purchased_at, 'monthly_card.purchased_at'),
    text(row.starts_at, 'monthly_card.starts_at'), text(row.expires_at, 'monthly_card.expires_at'),
    nullableText(row.paused_at), row.status === 'refunded' ? text(row.updated_at, 'monthly_card.updated_at') : null,
    text(row.updated_at, 'monthly_card.updated_at'), scopeType
  )
}

function applyMonthlyCardEvent(database: DatabaseSync, context: StoreContext, row: Json): void {
  const operationId = text(row.operation_id, 'monthly_card_event.operation_id')
  const occurrenceStoreId = nullableText(row.store_id) ?? context.storeId
  if (database.prepare('SELECT 1 FROM monthly_card_event WHERE id = ?').get(operationId)) return
  const rawEventType = text(
    row.event_type,
    'monthly_card_event.event_type'
  ).replace('monthly_card.', '')
  // Snapshot rows repair cloud projections; the monthly_cards resource already
  // materializes their state. They are not append-only business ledger events.
  if (rawEventType === 'snapshot') return
  const eventType = enumText(
    rawEventType,
    [
      'purchased',
      'paused',
      'resumed',
      'used',
      'refunded',
      'expired',
      'manual_extended',
      'reconciled'
    ] as const,
    'monthly_card_event.event_type'
  )
  database.prepare(
    `INSERT INTO monthly_card_event
     (id, tenant_id, store_id, card_id, member_id, event_type, request_id,
      actor_id, device_id, reason, metadata_json, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'cloud-sync', ?, ?, ?, ?)`
  ).run(
    operationId, context.tenantId, occurrenceStoreId,
    text(row.card_id, 'monthly_card_event.card_id'),
    text(row.member_id, 'monthly_card_event.member_id'),
    eventType,
    `cloud:${operationId}`, context.deviceId,
    nullableText(row.reason) ?? '云端同步', json(row.payload_json, {}),
    text(row.occurred_at, 'monthly_card_event.occurred_at')
  )
}

function applyWechatRechargeOrder(
  database: DatabaseSync,
  context: StoreContext,
  row: Json
): void {
  const id = text(row.id, 'wechat_recharge_order.id')
  const occurrenceStoreId = nullableText(row.store_id) ?? context.storeId
  database.prepare(
    `INSERT INTO wechat_recharge_order_mirror
     (id, tenant_id, store_id, member_id, identity_id, request_id,
      out_trade_no, provider_mode, provider_prepay_id,
      provider_transaction_id, principal_fen, gift_fen, status,
      error_message, expires_at, paid_at, settled_at, wallet_operation_id,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       store_id = excluded.store_id,
       member_id = excluded.member_id,
       provider_prepay_id = excluded.provider_prepay_id,
       provider_transaction_id = excluded.provider_transaction_id,
       principal_fen = excluded.principal_fen,
       gift_fen = excluded.gift_fen,
       status = excluded.status,
       error_message = excluded.error_message,
       expires_at = excluded.expires_at,
       paid_at = excluded.paid_at,
       settled_at = excluded.settled_at,
       wallet_operation_id = excluded.wallet_operation_id,
       updated_at = excluded.updated_at
     WHERE wechat_recharge_order_mirror.tenant_id = excluded.tenant_id`
  ).run(
    id,
    context.tenantId,
    occurrenceStoreId,
    text(row.member_id, 'wechat_recharge_order.member_id'),
    text(row.identity_id, 'wechat_recharge_order.identity_id'),
    text(row.request_id, 'wechat_recharge_order.request_id'),
    text(row.out_trade_no, 'wechat_recharge_order.out_trade_no'),
    text(row.provider_mode, 'wechat_recharge_order.provider_mode'),
    nullableText(row.provider_prepay_id),
    nullableText(row.provider_transaction_id),
    integer(row.principal_fen, 'wechat_recharge_order.principal_fen'),
    integer(row.gift_fen, 'wechat_recharge_order.gift_fen'),
    text(row.status, 'wechat_recharge_order.status'),
    nullableText(row.error_message),
    text(row.expires_at, 'wechat_recharge_order.expires_at'),
    nullableText(row.paid_at),
    nullableText(row.settled_at),
    nullableText(row.wallet_operation_id),
    text(row.created_at, 'wechat_recharge_order.created_at'),
    text(row.updated_at, 'wechat_recharge_order.updated_at')
  )
}

function applyMonthlyCardPaymentOrder(
  database: DatabaseSync,
  context: StoreContext,
  row: Json
): void {
  const id = text(row.id, 'wechat_monthly_card_order.id')
  const occurrenceStoreId = nullableText(row.store_id) ?? context.storeId
  database.prepare(
    `INSERT INTO wechat_monthly_card_order_mirror
     (id, tenant_id, store_id, member_id, identity_id, request_id,
      out_trade_no, provider_mode, provider_prepay_id,
      provider_transaction_id, plan_name, price_fen, duration_days,
      scope_type, status, target_card_id, expires_before, expires_after,
      error_message, expires_at, paid_at, settled_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       store_id = excluded.store_id,
       member_id = excluded.member_id,
       provider_prepay_id = excluded.provider_prepay_id,
       provider_transaction_id = excluded.provider_transaction_id,
       plan_name = excluded.plan_name,
       price_fen = excluded.price_fen,
       duration_days = excluded.duration_days,
       scope_type = excluded.scope_type,
       status = excluded.status,
       target_card_id = excluded.target_card_id,
       expires_before = excluded.expires_before,
       expires_after = excluded.expires_after,
       error_message = excluded.error_message,
       expires_at = excluded.expires_at,
       paid_at = excluded.paid_at,
       settled_at = excluded.settled_at,
       updated_at = excluded.updated_at
     WHERE wechat_monthly_card_order_mirror.tenant_id = excluded.tenant_id`
  ).run(
    id,
    context.tenantId,
    occurrenceStoreId,
    text(row.member_id, 'wechat_monthly_card_order.member_id'),
    text(row.identity_id, 'wechat_monthly_card_order.identity_id'),
    text(row.request_id, 'wechat_monthly_card_order.request_id'),
    text(row.out_trade_no, 'wechat_monthly_card_order.out_trade_no'),
    text(row.provider_mode, 'wechat_monthly_card_order.provider_mode'),
    nullableText(row.provider_prepay_id),
    nullableText(row.provider_transaction_id),
    text(row.plan_name, 'wechat_monthly_card_order.plan_name'),
    integer(row.price_fen, 'wechat_monthly_card_order.price_fen'),
    integer(row.duration_days, 'wechat_monthly_card_order.duration_days'),
    text(row.scope_type, 'wechat_monthly_card_order.scope_type'),
    text(row.status, 'wechat_monthly_card_order.status'),
    nullableText(row.target_card_id),
    nullableText(row.expires_before),
    nullableText(row.expires_after),
    nullableText(row.error_message),
    text(row.expires_at, 'wechat_monthly_card_order.expires_at'),
    nullableText(row.paid_at),
    nullableText(row.settled_at),
    text(row.created_at, 'wechat_monthly_card_order.created_at'),
    text(row.updated_at, 'wechat_monthly_card_order.updated_at')
  )
}

function applyBusinessTemplate(database: DatabaseSync, context: StoreContext, row: Json): void {
  const id = text(row.id, 'business_template.id')
  database.prepare(
    `INSERT INTO merchant_business_template
     (id, tenant_id, template_type, name, payload_json, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       template_type = excluded.template_type,
       name = excluded.name,
       payload_json = excluded.payload_json,
       active = excluded.active,
       updated_at = excluded.updated_at
     WHERE merchant_business_template.tenant_id = excluded.tenant_id`
  ).run(
    id,
    context.tenantId,
    text(row.template_type, 'business_template.template_type'),
    text(row.name, 'business_template.name'),
    json(row.payload_json, {}),
    bool(row.active),
    text(row.created_at, 'business_template.created_at'),
    text(row.updated_at, 'business_template.updated_at')
  )
  const overrideId = nullableText(row.override_id)
  if (!overrideId) {
    database.prepare(
      `DELETE FROM store_business_template_override
       WHERE tenant_id = ? AND store_id = ? AND template_id = ?`
    ).run(context.tenantId, context.storeId, id)
    resolveBusinessTemplateToStore(database, context, id)
    return
  }
  database.prepare(
    `INSERT INTO store_business_template_override
     (id, tenant_id, store_id, template_id, payload_json, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, store_id, template_id) DO UPDATE SET
       payload_json = excluded.payload_json,
       active = excluded.active,
       updated_at = excluded.updated_at`
  ).run(
    overrideId,
    context.tenantId,
    context.storeId,
    id,
    json(row.override_payload_json, {}),
    bool(row.override_active),
    text(row.override_created_at, 'business_template.override_created_at'),
    text(row.override_updated_at, 'business_template.override_updated_at')
  )
  resolveBusinessTemplateToStore(database, context, id)
}

function resolveBusinessTemplateToStore(
  database: DatabaseSync,
  context: StoreContext,
  templateId: string
): void {
  const row = database.prepare(
    `SELECT template.template_type, template.name,
            template.payload_json, template.updated_at,
            override.payload_json override_payload_json,
            COALESCE(override.active, template.active) resolved_active
     FROM merchant_business_template template
     LEFT JOIN store_business_template_override override
       ON override.tenant_id = template.tenant_id
      AND override.store_id = ? AND override.template_id = template.id
     WHERE template.id = ? AND template.tenant_id = ?`
  ).get(context.storeId, templateId, context.tenantId) as
    | {
        template_type: string
        name: string
        payload_json: string
        updated_at: string
        override_payload_json: string | null
        resolved_active: number
      }
    | undefined
  if (!row || Number(row.resolved_active) !== 1) return
  const base = JSON.parse(row.payload_json) as Json
  const override = row.override_payload_json
    ? JSON.parse(row.override_payload_json) as Json
    : {}
  const payload = { ...base, ...override }
  if (row.template_type === 'monthly_card_plan') {
    const priceFen = integer(payload.priceFen ?? 20_000, 'business_template.priceFen')
    const durationDays = integer(payload.durationDays ?? 30, 'business_template.durationDays')
    const scopeType = payload.scopeType === 'tenant' ? 'tenant' : 'store'
    const name = nullableText(payload.name) ?? row.name
    const existing = database.prepare(
      `SELECT id FROM monthly_card_plan
       WHERE tenant_id = ? AND store_id = ?
         AND (source_template_id = ? OR source_template_id IS NULL)
       ORDER BY CASE WHEN source_template_id = ? THEN 0 ELSE 1 END, created_at
       LIMIT 1`
    ).get(context.tenantId, context.storeId, templateId, templateId) as
      | { id: string }
      | undefined
    if (existing) {
      database.prepare(
        `UPDATE monthly_card_plan SET name = ?, price_fen = ?, duration_days = ?,
                active = 1, scope_type = ?, source_template_id = ?, updated_at = ?
         WHERE id = ?`
      ).run(name, priceFen, durationDays, scopeType, templateId, row.updated_at, existing.id)
    } else {
      database.prepare(
        `INSERT INTO monthly_card_plan
         (id, tenant_id, store_id, name, price_fen, duration_days, active,
          created_at, updated_at, scope_type, source_template_id)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
      ).run(randomUUID(), context.tenantId, context.storeId, name, priceFen,
        durationDays, row.updated_at, row.updated_at, scopeType, templateId)
    }
  } else if (row.template_type === 'recharge_gift_tier') {
    const tiers = Array.isArray(payload.tiers) ? payload.tiers : []
    database.prepare(
      `UPDATE recharge_gift_tier SET active = 0, updated_at = ?
       WHERE tenant_id = ? AND store_id = ?`
    ).run(row.updated_at, context.tenantId, context.storeId)
    const upsert = database.prepare(
      `INSERT INTO recharge_gift_tier
       (id, tenant_id, store_id, principal_fen, gift_fen, active,
        created_at, updated_at, source_template_id)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT (tenant_id, store_id, principal_fen) DO UPDATE SET
         gift_fen = excluded.gift_fen, active = 1,
         source_template_id = excluded.source_template_id,
         updated_at = excluded.updated_at`
    )
    for (const value of tiers) {
      if (!value || typeof value !== 'object') continue
      const tier = value as Json
      upsert.run(randomUUID(), context.tenantId, context.storeId,
        integer(tier.principalFen, 'business_template.principalFen'),
        integer(tier.giftFen, 'business_template.giftFen'),
        row.updated_at, row.updated_at, templateId)
    }
  } else if (row.template_type === 'activity') {
    const existing = database.prepare(
      `SELECT id FROM activity_campaign
       WHERE tenant_id = ? AND store_id = ? AND source_template_id = ?`
    ).get(context.tenantId, context.storeId, templateId) as { id: string } | undefined
    if (!existing) return
    const activityType = payload.activityType === 'recharge' ? 'recharge' : 'general'
    const title = nullableText(payload.title) ?? row.name
    const summary = nullableText(payload.summary) ?? title
    const content = nullableText(payload.content) ?? summary
    const startsAt = text(payload.startsAt, 'business_template.startsAt')
    const endsAt = text(payload.endsAt, 'business_template.endsAt')
    database.prepare(
      `UPDATE activity_campaign SET title = ?, summary = ?, content = ?,
              activity_type = ?, starts_at = ?, ends_at = ?, pinned = ?,
              regular_price_fen = ?, advanced_price_fen = ?,
              allow_stored_value = ?, allow_wechat = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      title, summary, content, activityType, startsAt, endsAt,
      bool(payload.pinned),
      payload.regularPriceFen === undefined || payload.regularPriceFen === null
        ? null : integer(payload.regularPriceFen, 'business_template.regularPriceFen'),
      payload.advancedPriceFen === undefined || payload.advancedPriceFen === null
        ? null : integer(payload.advancedPriceFen, 'business_template.advancedPriceFen'),
      bool(payload.allowStoredValue), bool(payload.allowWechat), row.updated_at, existing.id
    )
    database.prepare(
      `DELETE FROM activity_recharge_tier WHERE tenant_id = ? AND activity_id = ?`
    ).run(context.tenantId, existing.id)
    const insertTier = database.prepare(
      `INSERT INTO activity_recharge_tier
       (id, tenant_id, store_id, activity_id, principal_fen, gift_fen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const tiers = Array.isArray(payload.rechargeTiers) ? payload.rechargeTiers : []
    for (const value of tiers) {
      if (!value || typeof value !== 'object') continue
      const tier = value as Json
      insertTier.run(randomUUID(), context.tenantId, context.storeId, existing.id,
        integer(tier.principalFen, 'business_template.principalFen'),
        integer(tier.giftFen, 'business_template.giftFen'), row.updated_at)
    }
  }
}

function ensureCatalogForOrderItem(
  database: DatabaseSync,
  context: StoreContext,
  item: Json,
  timestamp: string,
  sourceStoreId: string
): void {
  const id = text(item.catalogItemId ?? item.catalog_item_id, 'order_item.catalog_item_id')
  if (database.prepare('SELECT 1 FROM catalog_item WHERE id = ?').get(id)) return
  const rawType = text(item.itemType ?? item.item_type, 'order_item.item_type')
  const itemType = rawType === 'custom' ? 'service' : rawType
  database.prepare(
    `INSERT INTO catalog_item
     (id, tenant_id, store_id, code, name, item_type, regular_price_fen,
      advanced_price_fen, status, availability, note, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'disabled', 'available',
             '云端订单快照占位', 'desktop', ?, ?)`
  ).run(
    id, context.tenantId, sourceStoreId, `CLOUD-${id.slice(0, 8)}`,
    text(item.itemName ?? item.item_name, 'order_item.item_name'), itemType,
    integer(item.regularPriceFen ?? item.regular_price_fen, 'order_item.regular_price'),
    integer(item.advancedPriceFen ?? item.advanced_price_fen, 'order_item.advanced_price'),
    timestamp, timestamp
  )
}

function applyOrder(database: DatabaseSync, context: StoreContext, row: Json): void {
  const id = text(row.id, 'order.id')
  const sourceStoreId = nullableText(row.store_id) ?? context.storeId
  if (hasPendingAggregate(database, context, id)) return
  const raw = row.payload_json && typeof row.payload_json === 'object' ? row.payload_json as Json : row
  const snapshot = raw.after && typeof raw.after === 'object' ? raw.after as Json : raw
  const timestamp = text(row.completed_at ?? snapshot.completedAt, 'order.completed_at')
  const items = Array.isArray(snapshot.items) ? snapshot.items.filter((value): value is Json => Boolean(value) && typeof value === 'object') : []
  for (const item of items) {
    ensureCatalogForOrderItem(database, context, item, timestamp, sourceStoreId)
  }
  const visitBatchId = text(row.visit_batch_id ?? snapshot.visitBatchId, 'order.visit_batch_id')
  database.prepare(
    `INSERT OR IGNORE INTO visit_batch
     (id, tenant_id, store_id, status, started_at, completed_at, created_by, device_id)
     VALUES (?, ?, ?, 'completed', ?, ?, 'cloud-sync', ?)`
  ).run(visitBatchId, context.tenantId, sourceStoreId, timestamp, timestamp, context.deviceId)
  database.prepare(
    `INSERT INTO sales_order
     (id, tenant_id, store_id, visit_batch_id, order_number,
      customer_member_id, payment_method, wallet_member_id, status, total_fen,
      request_id, note, completed_by, device_id, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, 'cloud-sync', ?, ?)
     ON CONFLICT (id) DO NOTHING`
  ).run(
    id, context.tenantId, sourceStoreId, visitBatchId,
    text(row.order_number ?? snapshot.orderNumber, 'order.order_number'),
    nullableText(row.customer_member_id ?? snapshot.customerMemberId),
    text(row.payment_method ?? snapshot.paymentMethod, 'order.payment_method'),
    nullableText(row.wallet_member_id ?? snapshot.walletMemberId),
    integer(row.total_fen ?? snapshot.totalFen, 'order.total_fen'),
    `cloud-order:${id}`, nullableText(row.note ?? snapshot.note), context.deviceId, timestamp
  )
  for (const item of items) {
    const rawType = text(item.itemType, 'order_item.item_type')
    database.prepare(
      `INSERT OR IGNORE INTO sales_order_item
       (id, tenant_id, store_id, order_id, catalog_item_id, item_name_snapshot,
        item_type_snapshot, regular_price_fen_snapshot,
        advanced_price_fen_snapshot, applied_unit_price_fen, pricing_tier,
        quantity, line_total_fen, benefit_type, beneficiary_member_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      text(item.id, 'order_item.id'), context.tenantId, sourceStoreId, id,
      text(item.catalogItemId, 'order_item.catalogItemId'),
      text(item.itemName, 'order_item.itemName'), rawType === 'custom' ? 'service' : rawType,
      integer(item.regularPriceFen, 'order_item.regularPriceFen'),
      integer(item.advancedPriceFen, 'order_item.advancedPriceFen'),
      integer(item.appliedUnitPriceFen, 'order_item.appliedUnitPriceFen'),
      text(item.pricingTier, 'order_item.pricingTier'),
      integer(item.quantity, 'order_item.quantity'),
      integer(item.lineTotalFen, 'order_item.lineTotalFen'),
      text(item.benefitType, 'order_item.benefitType'), nullableText(item.beneficiaryMemberId)
    )
  }
  database.prepare(
    `INSERT OR IGNORE INTO order_payment
     (id, tenant_id, store_id, order_id, payment_method, amount_fen,
      wallet_member_id, wallet_operation_id, status, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
  ).run(
    `cloud-payment:${id}`, context.tenantId, sourceStoreId, id,
    text(row.payment_method ?? snapshot.paymentMethod, 'order.payment_method'),
    integer(row.total_fen ?? snapshot.totalFen, 'order.total_fen'),
    nullableText(row.wallet_member_id ?? snapshot.walletMemberId),
    nullableText((snapshot.payment as Json | undefined)?.wallet_operation_id), timestamp
  )
}

function applyRefund(database: DatabaseSync, context: StoreContext, row: Json): void {
  const id = text(row.id, 'refund.id')
  const sourceStoreId = nullableText(row.store_id) ?? context.storeId
  if (hasPendingAggregate(database, context, id)) return
  const raw = row.payload_json && typeof row.payload_json === 'object' ? row.payload_json as Json : row
  const snapshot = raw.after && typeof raw.after === 'object' ? raw.after as Json : raw
  const orderId = text(row.order_id ?? snapshot.orderId, 'refund.order_id')
  if (!database.prepare('SELECT 1 FROM sales_order WHERE id = ?').get(orderId)) return
  database.prepare(
    `INSERT INTO refund_request
     (id, tenant_id, store_id, refund_number, order_id, original_payment_id,
      payment_method, wallet_member_id, status, total_fen, request_id,
      requested_by, requested_at, request_reason, approved_by, approved_at,
      approval_request_id, special_product_override, completion_reason,
      rejected_by, rejected_at, rejection_request_id, rejection_reason,
      completed_at, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = excluded.status,
       approved_by = excluded.approved_by, approved_at = excluded.approved_at,
       special_product_override = excluded.special_product_override,
       completion_reason = excluded.completion_reason,
       rejected_by = excluded.rejected_by, rejected_at = excluded.rejected_at,
       rejection_reason = excluded.rejection_reason,
       completed_at = excluded.completed_at`
  ).run(
    id, context.tenantId, sourceStoreId,
    text(row.refund_number ?? snapshot.refundNumber, 'refund.refund_number'),
    orderId, `cloud-payment:${orderId}`,
    text(row.payment_method ?? snapshot.paymentMethod, 'refund.payment_method'),
    nullableText(row.wallet_member_id ?? snapshot.walletMemberId),
    text(row.status ?? snapshot.status, 'refund.status'),
    integer(row.total_fen ?? snapshot.totalFen, 'refund.total_fen'),
    `cloud-refund:${id}`, text(snapshot.requestedBy ?? 'cloud-sync', 'refund.requestedBy'),
    text(row.requested_at ?? snapshot.requestedAt, 'refund.requested_at'),
    nullableText(snapshot.requestReason), nullableText(snapshot.approvedBy),
    nullableText(snapshot.approvedAt), snapshot.approvedAt ? `cloud-approve:${id}` : null,
    bool(snapshot.specialProductOverride), nullableText(snapshot.completionReason),
    nullableText(snapshot.rejectedBy), nullableText(snapshot.rejectedAt),
    snapshot.rejectedAt ? `cloud-reject:${id}` : null,
    nullableText(snapshot.rejectionReason), nullableText(row.completed_at ?? snapshot.completedAt),
    context.deviceId
  )
  const items = Array.isArray(snapshot.items) ? snapshot.items : []
  for (const value of items) {
    if (!value || typeof value !== 'object') continue
    const item = value as Json
    if (!database.prepare('SELECT 1 FROM sales_order_item WHERE id = ?').get(text(item.orderItemId, 'refund_item.orderItemId'))) continue
    database.prepare(
      `INSERT OR IGNORE INTO refund_item
       (id, tenant_id, store_id, refund_id, order_item_id, item_name_snapshot,
        item_type_snapshot, unit_refund_fen, quantity, line_refund_fen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      text(item.id, 'refund_item.id'), context.tenantId, sourceStoreId, id,
      text(item.orderItemId, 'refund_item.orderItemId'),
      text(item.itemName, 'refund_item.itemName'), text(item.itemType, 'refund_item.itemType'),
      integer(item.unitRefundFen, 'refund_item.unitRefundFen'),
      integer(item.quantity, 'refund_item.quantity'), integer(item.lineRefundFen, 'refund_item.lineRefundFen')
    )
  }
  if (text(row.status ?? snapshot.status, 'refund.status') === 'completed') {
    database.prepare(
      `INSERT OR IGNORE INTO refund_payment
       (id, tenant_id, store_id, refund_id, original_payment_id, payment_method,
        amount_fen, wallet_member_id, wallet_ledger_id, status, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'completed', ?)`
    ).run(
      `cloud-refund-payment:${id}`, context.tenantId, sourceStoreId, id,
      `cloud-payment:${orderId}`, text(row.payment_method ?? snapshot.paymentMethod, 'refund.payment_method'),
      integer(row.total_fen ?? snapshot.totalFen, 'refund.total_fen'),
      nullableText(row.wallet_member_id ?? snapshot.walletMemberId),
      text(row.completed_at ?? snapshot.completedAt, 'refund.completed_at')
    )
  }
}

function applyFinancialRefund(database: DatabaseSync, context: StoreContext, row: Json): void {
  const id = text(row.id, 'financial_refund.id')
  const sourceStoreId = nullableText(row.store_id) ?? context.storeId
  if (hasPendingAggregate(database, context, id)) return
  const raw = row.payload_json && typeof row.payload_json === 'object' ? row.payload_json as Json : row
  const snapshot = raw.after && typeof raw.after === 'object' ? raw.after as Json : raw
  database.prepare(
    `INSERT INTO financial_refund_request
     (id, tenant_id, store_id, request_number, target_type, target_id, member_id,
      payment_method, status, refund_principal_fen, reclaim_gift_fen, request_id,
      requested_by, requested_at, request_reason, approved_by, approved_at,
      approval_request_id, requires_special_override, special_override,
      completion_reason, execution_operation_id, rejected_by, rejected_at,
      rejection_request_id, rejection_reason, completed_at, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = excluded.status,
       approved_by = excluded.approved_by, approved_at = excluded.approved_at,
       special_override = excluded.special_override,
       completion_reason = excluded.completion_reason,
       execution_operation_id = excluded.execution_operation_id,
       rejected_by = excluded.rejected_by, rejected_at = excluded.rejected_at,
       rejection_reason = excluded.rejection_reason,
       completed_at = excluded.completed_at`
  ).run(
    id, context.tenantId, sourceStoreId,
    text(row.request_number ?? snapshot.requestNumber, 'financial_refund.request_number'),
    text(row.target_type ?? snapshot.targetType, 'financial_refund.target_type'),
    text(row.target_id ?? snapshot.targetId, 'financial_refund.target_id'),
    text(row.member_id ?? snapshot.memberId, 'financial_refund.member_id'),
    text(row.status ?? snapshot.status, 'financial_refund.status'),
    integer(row.refund_principal_fen ?? snapshot.refundPrincipalFen, 'financial_refund.refund_principal_fen'),
    integer(row.reclaim_gift_fen ?? snapshot.reclaimGiftFen, 'financial_refund.reclaim_gift_fen'),
    `cloud-financial-refund:${id}`, text(snapshot.requestedBy ?? 'cloud-sync', 'financial_refund.requestedBy'),
    text(row.requested_at ?? snapshot.requestedAt, 'financial_refund.requested_at'),
    nullableText(snapshot.requestReason), nullableText(snapshot.approvedBy),
    nullableText(snapshot.approvedAt), snapshot.approvedAt ? `cloud-approve:${id}` : null,
    bool(snapshot.requiresSpecialOverride), bool(snapshot.specialOverride),
    nullableText(snapshot.completionReason), nullableText(snapshot.executionOperationId),
    nullableText(snapshot.rejectedBy), nullableText(snapshot.rejectedAt),
    snapshot.rejectedAt ? `cloud-reject:${id}` : null,
    nullableText(snapshot.rejectionReason), nullableText(row.completed_at ?? snapshot.completedAt),
    context.deviceId
  )
}

export function applyCloudMirrorPage(
  database: DatabaseSync,
  context: StoreContext,
  page: CloudMirrorPage,
  inTransaction = false
): number {
  if (!inTransaction) database.exec('BEGIN IMMEDIATE')
  try {
    let applied = 0
    for (const item of page.rows) {
      const row = item.payload
      if (page.resource === 'store') applyStore(database, context, row)
      else if (page.resource === 'employees') applyEmployee(database, context, row)
      else if (page.resource === 'members') applyMember(database, context, row)
      else if (page.resource === 'catalog') applyCatalog(database, context, row)
      else if (page.resource === 'activities') applyActivity(database, context, row)
      else if (page.resource === 'announcements') applyAnnouncement(database, context, row)
      else if (page.resource === 'board_games') applyBoardGame(database, context, row)
      else if (page.resource === 'wallet_accounts') applyWalletAccount(database, context, row)
      else if (page.resource === 'wallet_ledger') applyWalletLedger(database, context, row)
      else if (page.resource === 'monthly_cards') applyMonthlyCard(database, context, row)
      else if (page.resource === 'monthly_card_events') applyMonthlyCardEvent(database, context, row)
      else if (page.resource === 'monthly_card_payment_orders') applyMonthlyCardPaymentOrder(database, context, row)
      else if (page.resource === 'wechat_recharge_orders') applyWechatRechargeOrder(database, context, row)
      else if (page.resource === 'business_templates') applyBusinessTemplate(database, context, row)
      else if (page.resource === 'orders') applyOrder(database, context, row)
      else if (page.resource === 'refunds') applyRefund(database, context, row)
      else if (page.resource === 'financial_refunds') applyFinancialRefund(database, context, row)
      applied += 1
    }
    if (!inTransaction) database.exec('COMMIT')
    return applied
  } catch (error) {
    if (!inTransaction) database.exec('ROLLBACK')
    throw error
  }
}

export function markCloudMirrorEventsApplied(
  database: DatabaseSync,
  context: StoreContext,
  eventCursor: string
): number {
  if (!/^(0|[1-9]\d*)$/.test(eventCursor)) {
    throw new Error('Cloud mirror event cursor is invalid')
  }
  const timestamp = new Date().toISOString()
  const result = database.prepare(
    `UPDATE sync_inbound_event AS event
     SET apply_status = 'applied', applied_at = ?,
         error_message = 'materialized_from_cloud_snapshot'
     WHERE event.tenant_id = ? AND event.store_id = ?
       AND (event.apply_status = 'pending' OR (
         event.apply_status = 'conflict'
         AND event.error_message = 'Local pending changes exist for the same aggregate'
       ))
       AND (length(event.sequence) < length(?)
         OR (length(event.sequence) = length(?) AND event.sequence <= ?))
       AND NOT EXISTS (
         SELECT 1 FROM outbox_operation local
         WHERE local.tenant_id = event.tenant_id
           AND local.store_id = event.store_id
           AND local.aggregate_id = event.aggregate_id
           AND local.sync_status <> 'confirmed'
       )`
  ).run(
    timestamp,
    context.tenantId,
    context.storeId,
    eventCursor,
    eventCursor,
    eventCursor
  )
  return Number(result.changes)
}
