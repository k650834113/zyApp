import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AnnouncementStatus,
  AnnouncementSummary,
  SaveAnnouncementFields
} from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'

type AnnouncementContext = StoreContext & { actor: EmployeeRecord }

function visibility(
  status: AnnouncementStatus,
  visibleFrom: string,
  visibleUntil: string | null,
  now: Date
): AnnouncementSummary['visibility'] {
  if (status === 'draft') return 'draft'
  if (status === 'disabled') return 'disabled'
  const timestamp = now.getTime()
  if (timestamp < Date.parse(visibleFrom)) return 'scheduled'
  if (visibleUntil && timestamp >= Date.parse(visibleUntil)) return 'ended'
  return 'active'
}

function validateFields(fields: SaveAnnouncementFields): void {
  if (fields.title.trim().length < 2 || fields.title.trim().length > 100) {
    throw new Error('Announcement title must contain 2-100 characters')
  }
  if (fields.content.trim().length < 2 || fields.content.trim().length > 5000) {
    throw new Error('Announcement content must contain 2-5000 characters')
  }
  const visibleFrom = Date.parse(fields.visibleFrom)
  const visibleUntil = fields.visibleUntil
    ? Date.parse(fields.visibleUntil)
    : null
  if (!Number.isFinite(visibleFrom)) {
    throw new Error('Announcement visible-from time is invalid')
  }
  if (
    visibleUntil !== null &&
    (!Number.isFinite(visibleUntil) || visibleUntil <= visibleFrom)
  ) {
    throw new Error('Announcement visible-until time must be later')
  }
}

function findAnnouncement(
  database: DatabaseSync,
  tenantId: string,
  announcementId: string,
  now = new Date()
): AnnouncementSummary {
  const row = database
    .prepare(
      `SELECT id, title, content, status, pinned, visible_from, visible_until,
              published_at, created_at, updated_at
       FROM announcement
       WHERE tenant_id = ? AND id = ?`
    )
    .get(tenantId, announcementId) as Record<string, unknown> | undefined
  if (!row) throw new Error('Announcement was not found')
  const status = row.status as AnnouncementStatus
  const visibleFrom = String(row.visible_from)
  const visibleUntil =
    row.visible_until === null ? null : String(row.visible_until)
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    status,
    visibility: visibility(status, visibleFrom, visibleUntil, now),
    pinned: Number(row.pinned) === 1,
    visibleFrom,
    visibleUntil,
    publishedAt:
      row.published_at === null ? null : String(row.published_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function appendAuditAndOutbox(
  database: DatabaseSync,
  context: AnnouncementContext,
  input: {
    action: string
    announcementId: string
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
    announcementId: input.announcementId,
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
       VALUES (?, ?, ?, ?, ?, ?, 'announcement', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actor.id,
      input.action,
      input.announcementId,
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
      input.announcementId,
      input.timestamp,
      payload,
      createHash('sha256').update(payload).digest('hex')
    )
}

export function listAnnouncements(
  database: DatabaseSync,
  context: StoreContext,
  now = new Date()
): AnnouncementSummary[] {
  const rows = database
    .prepare(
      `SELECT id FROM announcement
       WHERE tenant_id = ? AND store_id = ?
       ORDER BY pinned DESC, visible_from DESC, created_at DESC`
    )
    .all(context.tenantId, context.storeId) as Array<{ id: string }>
  return rows.map((row) =>
    findAnnouncement(database, context.tenantId, row.id, now)
  )
}

export function createAnnouncement(
  database: DatabaseSync,
  context: AnnouncementContext,
  fields: SaveAnnouncementFields
): AnnouncementSummary {
  validateFields(fields)
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `INSERT INTO announcement
         (id, tenant_id, store_id, title, content, status, pinned,
          visible_from, visible_until, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        context.tenantId,
        context.storeId,
        fields.title.trim(),
        fields.content.trim(),
        fields.pinned ? 1 : 0,
        fields.visibleFrom,
        fields.visibleUntil ?? null,
        context.actor.id,
        timestamp,
        timestamp
      )
    const after = findAnnouncement(database, context.tenantId, id)
    appendAuditAndOutbox(database, context, {
      action: 'announcement.created',
      announcementId: id,
      reason: '创建公告草稿',
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

export function updateAnnouncement(
  database: DatabaseSync,
  context: AnnouncementContext,
  announcementId: string,
  fields: SaveAnnouncementFields,
  reason: string
): AnnouncementSummary {
  validateFields(fields)
  const before = findAnnouncement(database, context.tenantId, announcementId)
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `UPDATE announcement SET title = ?, content = ?, pinned = ?,
           visible_from = ?, visible_until = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ?`
      )
      .run(
        fields.title.trim(),
        fields.content.trim(),
        fields.pinned ? 1 : 0,
        fields.visibleFrom,
        fields.visibleUntil ?? null,
        timestamp,
        context.tenantId,
        announcementId
      )
    const after = findAnnouncement(
      database,
      context.tenantId,
      announcementId
    )
    appendAuditAndOutbox(database, context, {
      action: 'announcement.updated',
      announcementId,
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

export function setAnnouncementStatus(
  database: DatabaseSync,
  context: AnnouncementContext,
  announcementId: string,
  status: 'published' | 'disabled',
  reason: string
): AnnouncementSummary {
  const before = findAnnouncement(database, context.tenantId, announcementId)
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `UPDATE announcement SET status = ?,
           published_by = CASE WHEN ? = 'published' THEN ? ELSE published_by END,
           published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END,
           updated_at = ?
         WHERE tenant_id = ? AND id = ?`
      )
      .run(
        status,
        status,
        context.actor.id,
        status,
        timestamp,
        timestamp,
        context.tenantId,
        announcementId
      )
    const after = findAnnouncement(
      database,
      context.tenantId,
      announcementId
    )
    appendAuditAndOutbox(database, context, {
      action:
        status === 'published'
          ? 'announcement.published'
          : 'announcement.disabled',
      announcementId,
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
