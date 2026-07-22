import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  CatalogAvailability,
  CatalogItemStatus,
  CatalogItemSummary,
  CatalogItemType
} from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'

type CatalogContext = StoreContext & {
  actor: EmployeeRecord
}

type CatalogRow = Record<string, unknown>

function hasCatalogStoreConfig(database: DatabaseSync): boolean {
  return Boolean(database.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_store_config'`
  ).get())
}

function mapCatalogItem(row: CatalogRow): CatalogItemSummary {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    itemType: row.item_type as CatalogItemType,
    regularPriceFen: Number(row.regular_price_fen),
    advancedPriceFen: Number(row.advanced_price_fen),
    status: row.status as CatalogItemStatus,
    availability: row.availability as CatalogAvailability,
    note: row.note === null ? null : String(row.note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function nextCode(id: string): string {
  return `C${id.replaceAll('-', '').slice(0, 10).toUpperCase()}`
}

function ensureDefaultAdmission(database: DatabaseSync, context: StoreContext): void {
  if (!hasCatalogStoreConfig(database)) {
    const existing = database.prepare(
      `SELECT id FROM catalog_item WHERE tenant_id = ? AND store_id = ?
       AND item_type = 'admission' LIMIT 1`
    ).get(context.tenantId, context.storeId)
    if (existing) return
  }
  const existing = database
    .prepare(
      `SELECT id, regular_price_fen, advanced_price_fen, status,
              availability, note, updated_at
       FROM catalog_item
       WHERE tenant_id = ? AND item_type = 'admission'
       LIMIT 1`
    )
    .get(context.tenantId) as CatalogRow | undefined
  if (existing && hasCatalogStoreConfig(database)) {
    database.prepare(
      `INSERT OR IGNORE INTO catalog_store_config
       (tenant_id, store_id, catalog_item_id, regular_price_fen,
        advanced_price_fen, status, availability, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(context.tenantId, context.storeId, String(existing.id),
      Number(existing.regular_price_fen), Number(existing.advanced_price_fen),
      String(existing.status), String(existing.availability),
      existing.note === null ? null : String(existing.note), String(existing.updated_at))
    return
  }
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  database
    .prepare(
      `INSERT INTO catalog_item
       (id, tenant_id, store_id, code, name, item_type, regular_price_fen,
        advanced_price_fen, status, availability, note, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, '入场费', 'admission', 4000, 3000,
               'active', 'available', '系统默认入场收费项目', 'desktop', ?, ?)`
    )
    .run(
      id,
      context.tenantId,
      context.storeId,
      nextCode(id),
      timestamp,
      timestamp
    )
  if (hasCatalogStoreConfig(database)) database.prepare(
    `INSERT INTO catalog_store_config
     (tenant_id, store_id, catalog_item_id, regular_price_fen,
      advanced_price_fen, status, availability, note, updated_at)
     VALUES (?, ?, ?, 4000, 3000, 'active', 'available',
             '系统默认入场收费项目', ?)`
  ).run(context.tenantId, context.storeId, id, timestamp)
}

function findCatalogItem(
  database: DatabaseSync,
  context: StoreContext,
  itemId: string
): CatalogItemSummary {
  if (!hasCatalogStoreConfig(database)) {
    const row = database.prepare(
      `SELECT id, code, name, item_type, regular_price_fen, advanced_price_fen,
              status, availability, note, created_at, updated_at
       FROM catalog_item WHERE tenant_id = ? AND id = ?`
    ).get(context.tenantId, itemId) as CatalogRow | undefined
    if (!row) throw new Error('Catalog item was not found')
    return mapCatalogItem(row)
  }
  const row = database
    .prepare(
      `SELECT item.id, item.code, item.name, item.item_type,
              COALESCE(config.regular_price_fen, item.regular_price_fen) regular_price_fen,
              COALESCE(config.advanced_price_fen, item.advanced_price_fen) advanced_price_fen,
              COALESCE(config.status, item.status) status,
              COALESCE(config.availability, item.availability) availability,
              COALESCE(config.note, item.note) note, item.created_at,
              COALESCE(config.updated_at, item.updated_at) updated_at
       FROM catalog_item item
       LEFT JOIN catalog_store_config config
         ON config.tenant_id = item.tenant_id AND config.store_id = ?
        AND config.catalog_item_id = item.id
       WHERE item.tenant_id = ? AND item.id = ?`
    )
    .get(context.storeId, context.tenantId, itemId) as CatalogRow | undefined
  if (!row) throw new Error('Catalog item was not found')
  return mapCatalogItem(row)
}

function nextDeviceSequence(database: DatabaseSync, deviceId: string, timestamp: string): number {
  const row = database.prepare('SELECT next_sequence FROM device WHERE id = ?').get(deviceId) as
    | { next_sequence: number }
    | undefined
  if (!row) throw new Error('Registered device is missing')
  database
    .prepare('UPDATE device SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?')
    .run(timestamp, deviceId)
  return row.next_sequence
}

function appendCatalogAuditAndOutbox(
  database: DatabaseSync,
  context: CatalogContext,
  input: {
    action: string
    itemId: string
    reason: string
    before: unknown
    after: unknown
    timestamp: string
  }
): void {
  const payload = JSON.stringify({
    action: input.action,
    itemId: input.itemId,
    before: input.before,
    after: input.after,
    reason: input.reason
  })
  const sequence = nextDeviceSequence(database, context.deviceId, input.timestamp)
  database
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 'catalog_item', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actor.id,
      input.action,
      input.itemId,
      input.reason,
      input.before === null ? null : JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.timestamp
    )
  database
    .prepare(
      `INSERT INTO outbox_operation
       (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
        operation_type, aggregate_id, base_version, occurred_at, payload_json, payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.deviceId,
      sequence,
      context.tenantId,
      context.storeId,
      context.actor.id,
      input.action,
      input.itemId,
      input.timestamp,
      payload,
      createHash('sha256').update(payload).digest('hex')
    )
}

export function listCatalogItems(
  database: DatabaseSync,
  context: StoreContext
): CatalogItemSummary[] {
  ensureDefaultAdmission(database, context)
  if (!hasCatalogStoreConfig(database)) {
    const rows = database.prepare(
      `SELECT id, code, name, item_type, regular_price_fen, advanced_price_fen,
              status, availability, note, created_at, updated_at
       FROM catalog_item WHERE tenant_id = ? AND store_id = ?
         AND code <> '__CUSTOM_COLLECTION__'
       ORDER BY CASE item_type WHEN 'admission' THEN 0 WHEN 'service' THEN 1
         WHEN 'product' THEN 2 ELSE 3 END, status DESC, name`
    ).all(context.tenantId, context.storeId) as CatalogRow[]
    return rows.map(mapCatalogItem)
  }
  const rows = database
    .prepare(
      `SELECT item.id, item.code, item.name, item.item_type,
              COALESCE(config.regular_price_fen, item.regular_price_fen) regular_price_fen,
              COALESCE(config.advanced_price_fen, item.advanced_price_fen) advanced_price_fen,
              COALESCE(config.status, item.status) status,
              COALESCE(config.availability, item.availability) availability,
              COALESCE(config.note, item.note) note, item.created_at,
              COALESCE(config.updated_at, item.updated_at) updated_at
       FROM catalog_item item
       LEFT JOIN catalog_store_config config
         ON config.tenant_id = item.tenant_id AND config.store_id = ?
        AND config.catalog_item_id = item.id
       WHERE item.tenant_id = ? AND item.code <> '__CUSTOM_COLLECTION__'
       ORDER BY CASE item_type
         WHEN 'admission' THEN 0 WHEN 'service' THEN 1
         WHEN 'product' THEN 2 ELSE 3 END,
         status DESC, name`
    )
    .all(context.storeId, context.tenantId) as CatalogRow[]
  return rows.map(mapCatalogItem)
}

export function createCatalogItem(
  database: DatabaseSync,
  context: CatalogContext,
  input: {
    name: string
    itemType: CatalogItemType
    regularPriceFen: number
    advancedPriceFen: number
    note?: string
  }
): CatalogItemSummary {
  if (context.actor.role !== 'manager') {
    throw new Error('Only managers can create catalog items')
  }
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT INTO catalog_item
         (id, tenant_id, store_id, code, name, item_type, regular_price_fen,
          advanced_price_fen, status, availability, note, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'available', ?, 'desktop', ?, ?)`
      )
      .run(
        id,
        context.tenantId,
        context.storeId,
        nextCode(id),
        input.name,
        input.itemType,
        input.regularPriceFen,
        input.advancedPriceFen,
        input.note?.trim() || null,
        timestamp,
        timestamp
      )
    if (hasCatalogStoreConfig(database)) database.prepare(
      `INSERT INTO catalog_store_config
       (tenant_id, store_id, catalog_item_id, regular_price_fen,
        advanced_price_fen, status, availability, note, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', 'available', ?, ?)`
    ).run(context.tenantId, context.storeId, id, input.regularPriceFen,
      input.advancedPriceFen, input.note?.trim() || null, timestamp)
    const after = findCatalogItem(database, context, id)
    appendCatalogAuditAndOutbox(database, context, {
      action: 'catalog.item.created',
      itemId: id,
      reason: '店长新增收费项目',
      before: null,
      after,
      timestamp
    })
    database.exec('COMMIT')
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function updateCatalogItem(
  database: DatabaseSync,
  context: CatalogContext,
  input: {
    itemId: string
    name: string
    itemType: CatalogItemType
    regularPriceFen: number
    advancedPriceFen: number
    note?: string
    reason: string
  }
): CatalogItemSummary {
  if (context.actor.role !== 'manager') {
    throw new Error('Only managers can change catalog prices')
  }
    const before = findCatalogItem(database, context, input.itemId)
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `UPDATE catalog_item
         SET name = ?, item_type = ?,
             ${hasCatalogStoreConfig(database)
               ? 'updated_at = ?'
               : 'regular_price_fen = ?, advanced_price_fen = ?, note = ?, updated_at = ?'}
         WHERE id = ? AND tenant_id = ?`
      )
      .run(
        input.name,
        input.itemType,
        ...(!hasCatalogStoreConfig(database)
          ? [input.regularPriceFen, input.advancedPriceFen, input.note?.trim() || null]
          : []),
        timestamp,
        input.itemId,
        context.tenantId
      )
    if (hasCatalogStoreConfig(database)) database.prepare(
      `INSERT INTO catalog_store_config
       (tenant_id, store_id, catalog_item_id, regular_price_fen,
        advanced_price_fen, status, availability, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, store_id, catalog_item_id) DO UPDATE SET
         regular_price_fen = excluded.regular_price_fen,
         advanced_price_fen = excluded.advanced_price_fen,
         note = excluded.note, updated_at = excluded.updated_at`
    ).run(context.tenantId, context.storeId, input.itemId,
      input.regularPriceFen, input.advancedPriceFen, before.status,
      before.availability, input.note?.trim() || null, timestamp)
    const after = findCatalogItem(database, context, input.itemId)
    appendCatalogAuditAndOutbox(database, context, {
      action: 'catalog.item.updated',
      itemId: input.itemId,
      reason: input.reason,
      before,
      after,
      timestamp
    })
    database.exec('COMMIT')
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function setCatalogItemStatus(
  database: DatabaseSync,
  context: CatalogContext,
  input: { itemId: string; status: CatalogItemStatus; reason: string }
): CatalogItemSummary {
  if (context.actor.role !== 'manager') {
    throw new Error('Only managers can enable or disable catalog items')
  }
  const before = findCatalogItem(database, context, input.itemId)
  if (before.status === input.status) return before
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    if (hasCatalogStoreConfig(database)) database
      .prepare(
        `INSERT INTO catalog_store_config
         (tenant_id, store_id, catalog_item_id, regular_price_fen,
          advanced_price_fen, status, availability, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, store_id, catalog_item_id) DO UPDATE SET
           status = excluded.status, updated_at = excluded.updated_at`
      )
      .run(context.tenantId, context.storeId, input.itemId,
        before.regularPriceFen, before.advancedPriceFen, input.status,
        before.availability, before.note, timestamp)
    else database.prepare(
      `UPDATE catalog_item SET status = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    ).run(input.status, timestamp, input.itemId, context.tenantId)
    const after = findCatalogItem(database, context, input.itemId)
    appendCatalogAuditAndOutbox(database, context, {
      action:
        input.status === 'active' ? 'catalog.item.enabled' : 'catalog.item.disabled',
      itemId: input.itemId,
      reason: input.reason,
      before,
      after,
      timestamp
    })
    database.exec('COMMIT')
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function setCatalogAvailability(
  database: DatabaseSync,
  context: CatalogContext,
  input: { itemId: string; availability: CatalogAvailability; reason: string }
): CatalogItemSummary {
  const before = findCatalogItem(database, context, input.itemId)
  if (before.availability === input.availability) return before
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    if (hasCatalogStoreConfig(database)) database
      .prepare(
        `INSERT INTO catalog_store_config
         (tenant_id, store_id, catalog_item_id, regular_price_fen,
          advanced_price_fen, status, availability, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, store_id, catalog_item_id) DO UPDATE SET
           availability = excluded.availability, updated_at = excluded.updated_at`
      )
      .run(context.tenantId, context.storeId, input.itemId,
        before.regularPriceFen, before.advancedPriceFen, before.status,
        input.availability, before.note, timestamp)
    else database.prepare(
      `UPDATE catalog_item SET availability = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`
    ).run(input.availability, timestamp, input.itemId, context.tenantId)
    const after = findCatalogItem(database, context, input.itemId)
    appendCatalogAuditAndOutbox(database, context, {
      action:
        input.availability === 'available'
          ? 'catalog.item.available'
          : 'catalog.item.sold_out',
      itemId: input.itemId,
      reason: input.reason,
      before,
      after,
      timestamp
    })
    database.exec('COMMIT')
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
