import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  BoardGameRecordStatus,
  BoardGameSummary,
  SaveBoardGameFields,
  UpdateBoardGameOperationsRequest
} from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'

type BoardGameContext = StoreContext & { actor: EmployeeRecord }

function hasBoardGameStoreConfig(database: DatabaseSync): boolean {
  return Boolean(database.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'board_game_store_config'`
  ).get())
}

function optionalText(value: string | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized || null
}

function normalizeCategories(categories: string[]): string[] {
  return [...new Set(categories.map((value) => value.trim()).filter(Boolean))]
}

function validateOperationalFields(
  fields: Pick<
    SaveBoardGameFields,
    | 'customerConsigned'
    | 'missingPieces'
    | 'consignorNickname'
    | 'missingParts'
  >
): void {
  if (fields.customerConsigned && !optionalText(fields.consignorNickname)) {
    throw new Error('Customer-consigned games require a consignor nickname')
  }
  if (fields.missingPieces && fields.missingParts.length === 0) {
    throw new Error('Missing-piece games require at least one missing part')
  }
  for (const part of fields.missingParts) {
    if (part.name.trim().length < 1 || part.name.trim().length > 100) {
      throw new Error('Missing part names must contain 1-100 characters')
    }
    if (!Number.isSafeInteger(part.quantity) || part.quantity <= 0) {
      throw new Error('Missing part quantities must be positive integers')
    }
  }
}

function validateFields(fields: SaveBoardGameFields): void {
  if (fields.name.trim().length < 1 || fields.name.trim().length > 120) {
    throw new Error('Board-game name must contain 1-120 characters')
  }
  if (
    fields.introduction.trim().length < 2 ||
    fields.introduction.trim().length > 5000
  ) {
    throw new Error('Board-game introduction must contain 2-5000 characters')
  }
  const categories = normalizeCategories(fields.categories)
  if (categories.length === 0 || categories.length > 20) {
    throw new Error('Board games require 1-20 categories')
  }
  if (categories.some((value) => value.length > 40)) {
    throw new Error('Board-game categories must not exceed 40 characters')
  }
  if (
    !Number.isSafeInteger(fields.minPlayers) ||
    fields.minPlayers < 1 ||
    !Number.isSafeInteger(fields.maxPlayers) ||
    fields.maxPlayers < fields.minPlayers
  ) {
    throw new Error('Board-game player range is invalid')
  }
  for (const value of [fields.minMinutes, fields.maxMinutes]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error('Board-game duration must use positive integer minutes')
    }
  }
  if (
    fields.minMinutes !== undefined &&
    fields.maxMinutes !== undefined &&
    fields.maxMinutes < fields.minMinutes
  ) {
    throw new Error('Board-game maximum duration must not be shorter')
  }
  if (!Number.isSafeInteger(fields.quantity) || fields.quantity < 0) {
    throw new Error('Board-game quantity must be a non-negative integer')
  }
  if (fields.imageUrl) {
    let url: URL
    try {
      url = new URL(fields.imageUrl)
    } catch {
      throw new Error('Board-game image URL is invalid')
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Board-game image URL must use HTTP or HTTPS')
    }
  }
  if (
    fields.bggId !== undefined &&
    (!Number.isSafeInteger(fields.bggId) || fields.bggId <= 0)
  ) {
    throw new Error('BGG id must be a positive integer')
  }
  validateOperationalFields(fields)
}

function findBoardGame(
  database: DatabaseSync,
  context: StoreContext,
  boardGameId: string
): BoardGameSummary {
  const configured = hasBoardGameStoreConfig(database)
  const row = database
    .prepare(
      configured
        ? `SELECT game.id, game.name, game.introduction, game.categories_json,
                  game.min_players, game.max_players, game.min_minutes,
                  game.max_minutes, game.difficulty,
                  COALESCE(config.quantity, game.quantity) quantity,
                  COALESCE(config.record_status, game.record_status) record_status,
                  COALESCE(config.available, game.available) available,
                  COALESCE(config.customer_consigned, game.customer_consigned) customer_consigned,
                  COALESCE(config.missing_pieces, game.missing_pieces) missing_pieces,
                  COALESCE(config.private, game.private) private,
                  COALESCE(config.recommended, game.recommended) recommended,
                  game.image_url, game.local_image_path, game.bgg_id,
                  COALESCE(config.customer_note, game.customer_note) customer_note,
                  COALESCE(config.internal_note, game.internal_note) internal_note,
                  COALESCE(config.consignor_nickname, game.consignor_nickname) consignor_nickname,
                  game.created_at, COALESCE(config.updated_at, game.updated_at) updated_at
           FROM board_game game
           LEFT JOIN board_game_store_config config
             ON config.tenant_id = game.tenant_id AND config.store_id = ?
            AND config.board_game_id = game.id
           WHERE game.tenant_id = ? AND game.id = ?`
        : `SELECT id, name, introduction, categories_json, min_players,
                  max_players, min_minutes, max_minutes, difficulty, quantity,
                  record_status, available, customer_consigned, missing_pieces,
                  private, recommended, image_url, local_image_path, bgg_id,
                  customer_note, internal_note, consignor_nickname,
                  created_at, updated_at
           FROM board_game WHERE tenant_id = ? AND id = ?`
    )
    .get(...(configured
      ? [context.storeId, context.tenantId, boardGameId]
      : [context.tenantId, boardGameId])) as Record<string, unknown> | undefined
  if (!row) throw new Error('Board game was not found')
  const parts = database
    .prepare(
      `SELECT id, name, quantity
       FROM board_game_missing_part
       WHERE tenant_id = ? AND board_game_id = ?${configured ? ' AND store_id = ?' : ''}
       ORDER BY name, id`
    )
    .all(...(configured
      ? [context.tenantId, boardGameId, context.storeId]
      : [context.tenantId, boardGameId])) as Array<Record<string, unknown>>
  const parsedCategories = JSON.parse(String(row.categories_json)) as unknown
  if (
    !Array.isArray(parsedCategories) ||
    parsedCategories.some((value) => typeof value !== 'string')
  ) {
    throw new Error('Board-game categories are corrupted')
  }
  return {
    id: String(row.id),
    name: String(row.name),
    introduction: String(row.introduction),
    categories: parsedCategories,
    minPlayers: Number(row.min_players),
    maxPlayers: Number(row.max_players),
    minMinutes: row.min_minutes === null ? null : Number(row.min_minutes),
    maxMinutes: row.max_minutes === null ? null : Number(row.max_minutes),
    difficulty: row.difficulty as BoardGameSummary['difficulty'],
    quantity: Number(row.quantity),
    recordStatus: row.record_status as BoardGameRecordStatus,
    available: Number(row.available) === 1,
    customerConsigned: Number(row.customer_consigned) === 1,
    missingPieces: Number(row.missing_pieces) === 1,
    private: Number(row.private) === 1,
    recommended: Number(row.recommended) === 1,
    imageUrl: row.image_url === null ? null : String(row.image_url),
    localImagePath:
      row.local_image_path === null ? null : String(row.local_image_path),
    bggId: row.bgg_id === null ? null : Number(row.bgg_id),
    customerNote:
      row.customer_note === null ? null : String(row.customer_note),
    internalNote:
      row.internal_note === null ? null : String(row.internal_note),
    consignorNickname:
      row.consignor_nickname === null
        ? null
        : String(row.consignor_nickname),
    missingParts: parts.map((part) => ({
      id: String(part.id),
      name: String(part.name),
      quantity: Number(part.quantity)
    })),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function replaceMissingParts(
  database: DatabaseSync,
  context: StoreContext,
  boardGameId: string,
  parts: SaveBoardGameFields['missingParts'],
  timestamp: string
): void {
  database
    .prepare(
      `DELETE FROM board_game_missing_part
       WHERE tenant_id = ? AND board_game_id = ?`
    )
    .run(context.tenantId, boardGameId)
  const insert = database.prepare(
    `INSERT INTO board_game_missing_part
     (id, tenant_id, store_id, board_game_id, name, quantity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const part of parts) {
    insert.run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      boardGameId,
      part.name.trim(),
      part.quantity,
      timestamp
    )
  }
}

function appendAuditAndOutbox(
  database: DatabaseSync,
  context: BoardGameContext,
  input: {
    action: string
    boardGameId: string
    reason: string
    before: unknown
    after: unknown
    timestamp: string
  }
): void {
  const sequence = database
    .prepare('SELECT next_sequence FROM device WHERE id = ?')
    .get(context.deviceId) as { next_sequence: number } | undefined
  if (!sequence) throw new Error('Registered device is missing')
  const payload = JSON.stringify({
    action: input.action,
    boardGameId: input.boardGameId,
    before: input.before,
    after: input.after,
    reason: input.reason
  })
  database
    .prepare(
      'UPDATE device SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?'
    )
    .run(input.timestamp, context.deviceId)
  database
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 'board_game', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actor.id,
      input.action,
      input.boardGameId,
      input.reason,
      input.before === null ? null : JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.timestamp
    )
  database
    .prepare(
      `INSERT INTO outbox_operation
       (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
        operation_type, aggregate_id, base_version, occurred_at, payload_json,
        payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.deviceId,
      sequence.next_sequence,
      context.tenantId,
      context.storeId,
      context.actor.id,
      input.action,
      input.boardGameId,
      input.timestamp,
      payload,
      createHash('sha256').update(payload).digest('hex')
    )
}

export function listBoardGames(
  database: DatabaseSync,
  context: StoreContext
): BoardGameSummary[] {
  const configured = hasBoardGameStoreConfig(database)
  const rows = database
    .prepare(
      configured
        ? `SELECT game.id FROM board_game game
           LEFT JOIN board_game_store_config config
             ON config.tenant_id = game.tenant_id AND config.store_id = ?
            AND config.board_game_id = game.id
           WHERE game.tenant_id = ?
           ORDER BY COALESCE(config.recommended, game.recommended) DESC,
                    game.name COLLATE NOCASE, game.created_at DESC`
        : `SELECT id FROM board_game WHERE tenant_id = ? AND store_id = ?
           ORDER BY recommended DESC, name COLLATE NOCASE, created_at DESC`
    )
    .all(...(configured
      ? [context.storeId, context.tenantId]
      : [context.tenantId, context.storeId])) as Array<{ id: string }>
  return rows.map((row) =>
    findBoardGame(database, context, row.id)
  )
}

export function createBoardGame(
  database: DatabaseSync,
  context: BoardGameContext,
  fields: SaveBoardGameFields
): BoardGameSummary {
  validateFields(fields)
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  const categories = normalizeCategories(fields.categories)
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT INTO board_game
         (id, tenant_id, store_id, name, introduction, categories_json,
          min_players, max_players, min_minutes, max_minutes, difficulty,
          quantity, record_status, available, customer_consigned,
          missing_pieces, private, recommended, image_url, local_image_path,
          bgg_id, customer_note, internal_note, consignor_nickname,
          created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        context.tenantId,
        context.storeId,
        fields.name.trim(),
        fields.introduction.trim(),
        JSON.stringify(categories),
        fields.minPlayers,
        fields.maxPlayers,
        fields.minMinutes ?? null,
        fields.maxMinutes ?? null,
        fields.difficulty,
        fields.quantity,
        fields.available ? 1 : 0,
        fields.customerConsigned ? 1 : 0,
        fields.missingPieces ? 1 : 0,
        fields.private ? 1 : 0,
        fields.recommended ? 1 : 0,
        optionalText(fields.imageUrl),
        optionalText(fields.localImagePath),
        fields.bggId ?? null,
        optionalText(fields.customerNote),
        optionalText(fields.internalNote),
        optionalText(fields.consignorNickname),
        context.actor.id,
        timestamp,
        timestamp
      )
    replaceMissingParts(
      database,
      context,
      id,
      fields.missingPieces ? fields.missingParts : [],
      timestamp
    )
    if (hasBoardGameStoreConfig(database)) database.prepare(
      `INSERT INTO board_game_store_config
       (tenant_id, store_id, board_game_id, quantity, record_status, available,
        customer_consigned, missing_pieces, private, recommended, customer_note,
        internal_note, consignor_nickname, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(context.tenantId, context.storeId, id, fields.quantity,
      fields.available ? 1 : 0, fields.customerConsigned ? 1 : 0,
      fields.missingPieces ? 1 : 0, fields.private ? 1 : 0,
      fields.recommended ? 1 : 0, optionalText(fields.customerNote),
      optionalText(fields.internalNote), optionalText(fields.consignorNickname), timestamp)
    const after = findBoardGame(database, context, id)
    appendAuditAndOutbox(database, context, {
      action: 'board_game.created',
      boardGameId: id,
      reason: '新增桌游资料',
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

export function updateBoardGame(
  database: DatabaseSync,
  context: BoardGameContext,
  boardGameId: string,
  fields: SaveBoardGameFields,
  reason: string
): BoardGameSummary {
  validateFields(fields)
  const before = findBoardGame(database, context, boardGameId)
  const timestamp = new Date().toISOString()
  const categories = normalizeCategories(fields.categories)
  database.exec('BEGIN IMMEDIATE')
  try {
    const configured = hasBoardGameStoreConfig(database)
    database
      .prepare(
        configured
          ? `UPDATE board_game SET name = ?, introduction = ?,
             categories_json = ?, min_players = ?, max_players = ?,
             min_minutes = ?, max_minutes = ?, difficulty = ?, image_url = ?,
             local_image_path = ?, bgg_id = ?, updated_at = ?
           WHERE tenant_id = ? AND id = ?`
          : `UPDATE board_game SET name = ?, introduction = ?,
           categories_json = ?, min_players = ?, max_players = ?,
           min_minutes = ?, max_minutes = ?, difficulty = ?, quantity = ?,
           available = ?, customer_consigned = ?, missing_pieces = ?,
           private = ?, recommended = ?, image_url = ?, local_image_path = ?,
           bgg_id = ?, customer_note = ?, internal_note = ?,
           consignor_nickname = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`
      )
      .run(
        fields.name.trim(),
        fields.introduction.trim(),
        JSON.stringify(categories),
        fields.minPlayers,
        fields.maxPlayers,
        fields.minMinutes ?? null,
        fields.maxMinutes ?? null,
        fields.difficulty,
        ...(configured ? [] : [fields.quantity, fields.available ? 1 : 0,
          fields.customerConsigned ? 1 : 0, fields.missingPieces ? 1 : 0,
          fields.private ? 1 : 0, fields.recommended ? 1 : 0]),
        optionalText(fields.imageUrl),
        optionalText(fields.localImagePath),
        fields.bggId ?? null,
        ...(!configured ? [optionalText(fields.customerNote),
          optionalText(fields.internalNote), optionalText(fields.consignorNickname)] : []),
        timestamp,
        context.tenantId,
        boardGameId
      )
    replaceMissingParts(
      database,
      context,
      boardGameId,
      fields.missingPieces ? fields.missingParts : [],
      timestamp
    )
    if (hasBoardGameStoreConfig(database)) database.prepare(
      `INSERT INTO board_game_store_config
       (tenant_id, store_id, board_game_id, quantity, record_status, available,
        customer_consigned, missing_pieces, private, recommended, customer_note,
        internal_note, consignor_nickname, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, store_id, board_game_id) DO UPDATE SET
         quantity = excluded.quantity, available = excluded.available,
         customer_consigned = excluded.customer_consigned,
         missing_pieces = excluded.missing_pieces, private = excluded.private,
         recommended = excluded.recommended, customer_note = excluded.customer_note,
         internal_note = excluded.internal_note,
         consignor_nickname = excluded.consignor_nickname,
         updated_at = excluded.updated_at`
    ).run(context.tenantId, context.storeId, boardGameId, fields.quantity,
      before.recordStatus, fields.available ? 1 : 0,
      fields.customerConsigned ? 1 : 0, fields.missingPieces ? 1 : 0,
      fields.private ? 1 : 0, fields.recommended ? 1 : 0,
      optionalText(fields.customerNote), optionalText(fields.internalNote),
      optionalText(fields.consignorNickname), timestamp)
    const after = findBoardGame(database, context, boardGameId)
    appendAuditAndOutbox(database, context, {
      action: 'board_game.updated',
      boardGameId,
      reason,
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

export function updateBoardGameOperations(
  database: DatabaseSync,
  context: BoardGameContext,
  request: UpdateBoardGameOperationsRequest
): BoardGameSummary {
  validateOperationalFields(request)
  const before = findBoardGame(database, context, request.boardGameId)
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    if (!hasBoardGameStoreConfig(database)) database
      .prepare(
        `UPDATE board_game SET available = ?, customer_consigned = ?,
           missing_pieces = ?, private = ?, customer_note = ?,
           internal_note = ?, consignor_nickname = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`
      )
      .run(
        request.available ? 1 : 0,
        request.customerConsigned ? 1 : 0,
        request.missingPieces ? 1 : 0,
        request.private ? 1 : 0,
        optionalText(request.customerNote),
        optionalText(request.internalNote),
        optionalText(request.consignorNickname),
        timestamp,
        context.tenantId,
        request.boardGameId
      )
    replaceMissingParts(
      database,
      context,
      request.boardGameId,
      request.missingPieces ? request.missingParts : [],
      timestamp
    )
    if (hasBoardGameStoreConfig(database)) database.prepare(
      `INSERT INTO board_game_store_config
       (tenant_id, store_id, board_game_id, quantity, record_status, available,
        customer_consigned, missing_pieces, private, recommended, customer_note,
        internal_note, consignor_nickname, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, store_id, board_game_id) DO UPDATE SET
         available = excluded.available,
         customer_consigned = excluded.customer_consigned,
         missing_pieces = excluded.missing_pieces, private = excluded.private,
         customer_note = excluded.customer_note,
         internal_note = excluded.internal_note,
         consignor_nickname = excluded.consignor_nickname,
         updated_at = excluded.updated_at`
    ).run(context.tenantId, context.storeId, request.boardGameId,
      before.quantity, before.recordStatus, request.available ? 1 : 0,
      request.customerConsigned ? 1 : 0, request.missingPieces ? 1 : 0,
      request.private ? 1 : 0, before.recommended ? 1 : 0,
      optionalText(request.customerNote), optionalText(request.internalNote),
      optionalText(request.consignorNickname), timestamp)
    const after = findBoardGame(database, context, request.boardGameId)
    appendAuditAndOutbox(database, context, {
      action: 'board_game.operations.updated',
      boardGameId: request.boardGameId,
      reason: request.reason,
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

export function setBoardGameRecordStatus(
  database: DatabaseSync,
  context: BoardGameContext,
  boardGameId: string,
  status: BoardGameRecordStatus,
  reason: string
): BoardGameSummary {
  const before = findBoardGame(database, context, boardGameId)
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    if (!hasBoardGameStoreConfig(database)) database
      .prepare(
        `UPDATE board_game SET record_status = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`
      )
      .run(status, timestamp, context.tenantId, boardGameId)
    if (hasBoardGameStoreConfig(database)) database.prepare(
      `INSERT INTO board_game_store_config
       (tenant_id, store_id, board_game_id, quantity, record_status, available,
        customer_consigned, missing_pieces, private, recommended, customer_note,
        internal_note, consignor_nickname, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, store_id, board_game_id) DO UPDATE SET
         record_status = excluded.record_status, updated_at = excluded.updated_at`
    ).run(context.tenantId, context.storeId, boardGameId, before.quantity,
      status, before.available ? 1 : 0, before.customerConsigned ? 1 : 0,
      before.missingPieces ? 1 : 0, before.private ? 1 : 0,
      before.recommended ? 1 : 0, before.customerNote, before.internalNote,
      before.consignorNickname, timestamp)
    const after = findBoardGame(database, context, boardGameId)
    appendAuditAndOutbox(database, context, {
      action:
        status === 'active'
          ? 'board_game.enabled'
          : 'board_game.disabled',
      boardGameId,
      reason,
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
