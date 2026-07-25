import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { EmployeeRecord, StoreContext } from './identity'

export type MemberRecord = {
  id: string
  memberNumber: string
  phone: string
  nickname: string
  tier: 'ordinary' | 'advanced'
  status: 'active' | 'disabled'
  birthdayMonth: number | null
  birthdayDay: number | null
  birthdaySource: 'customer' | 'manager_correction' | 'legacy' | null
  note: string | null
  source: 'desktop' | 'miniapp' | 'legacy'
  ageGate:
    | 'confirmed_at_least_14'
    | 'under_14_verified'
    | 'recharge_disabled'
  createdAt: string
  updatedAt: string
}

export type CashierMemberRecord = MemberRecord & {
  lastActiveAt: string | null
}

type MemberWriteContext = StoreContext & {
  actor: EmployeeRecord
}

function mapMember(row: Record<string, unknown>): MemberRecord {
  return {
    id: String(row.id),
    memberNumber: String(row.member_number),
    phone: String(row.phone),
    nickname: String(row.nickname),
    tier: Number(row.advanced_grants) > 0 ? 'advanced' : 'ordinary',
    status: row.status === 'active' ? 'active' : 'disabled',
    birthdayMonth: row.birthday_month === null ? null : Number(row.birthday_month),
    birthdayDay: row.birthday_day === null ? null : Number(row.birthday_day),
    birthdaySource:
      row.birthday_source === 'customer' ||
      row.birthday_source === 'manager_correction' ||
      row.birthday_source === 'legacy'
        ? row.birthday_source
        : null,
    note: row.note === null ? null : String(row.note),
    source:
      row.source === 'miniapp' || row.source === 'legacy' ? row.source : 'desktop',
    ageGate:
      row.age_gate_status === 'under_14_verified' ||
      row.age_gate_status === 'recharge_disabled'
        ? row.age_gate_status
        : 'confirmed_at_least_14',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

function memberAgeGateSelectSql(database: DatabaseSync): string {
  return hasMemberAgeGateColumn(database)
    ? 'm.age_gate_status'
    : `CASE
         WHEN m.confirmed_at_least_14 = 1 THEN 'confirmed_at_least_14'
         ELSE 'recharge_disabled'
       END AS age_gate_status`
}

function memberSelectSql(database: DatabaseSync): string {
  return `
    SELECT m.id, m.member_number, m.phone, m.nickname, m.status,
           m.birthday_month, m.birthday_day, m.birthday_source, m.note, m.source,
           ${memberAgeGateSelectSql(database)},
           m.created_at, m.updated_at,
           COUNT(CASE WHEN g.id IS NOT NULL AND g.revoked_at IS NULL THEN 1 END)
             AS advanced_grants
    FROM member m
    LEFT JOIN membership_grant g ON g.member_id = m.id
  `
}

function appendMemberAuditAndOutbox(
  database: DatabaseSync,
  context: MemberWriteContext,
  input: {
    action: string
    operationType: string
    memberId: string
    reason: string
    before: unknown
    after: unknown
  }
): void {
  const timestamp = new Date().toISOString()
  const sequenceRow = database
    .prepare('SELECT next_sequence FROM device WHERE id = ?')
    .get(context.deviceId) as { next_sequence: number } | undefined
  if (!sequenceRow) {
    throw new Error('Registered device is missing')
  }
  database
    .prepare('UPDATE device SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?')
    .run(timestamp, context.deviceId)

  const payload = JSON.stringify({
    action: input.action,
    memberId: input.memberId,
    before: input.before,
    after: input.after,
    reason: input.reason
  })
  const payloadHash = createHash('sha256').update(payload).digest('hex')

  database
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 'member', ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actor.id,
      input.action,
      input.memberId,
      input.reason,
      input.before === null ? null : JSON.stringify(input.before),
      input.after === null ? null : JSON.stringify(input.after),
      timestamp
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
      sequenceRow.next_sequence,
      context.tenantId,
      context.storeId,
      context.actor.id,
      input.operationType,
      input.memberId,
      timestamp,
      payload,
      payloadHash
    )
}

function findMemberById(database: DatabaseSync, tenantId: string, memberId: string): MemberRecord {
  const row = database
    .prepare(
      `${memberSelectSql(database)}
       WHERE m.tenant_id = ? AND m.id = ?
       GROUP BY m.id`
    )
    .get(tenantId, memberId) as Record<string, unknown> | undefined
  if (!row) {
    throw new Error('Member was not found')
  }
  return mapMember(row)
}

function findMemberByPhone(
  database: DatabaseSync,
  tenantId: string,
  phone: string
): MemberRecord | null {
  const row = database
    .prepare(
      `${memberSelectSql(database)}
       WHERE m.tenant_id = ? AND m.phone = ?
       GROUP BY m.id`
    )
    .get(tenantId, phone) as Record<string, unknown> | undefined
  return row ? mapMember(row) : null
}

function nextMemberNumber(id: string): string {
  return `M${id.replaceAll('-', '').slice(0, 10).toUpperCase()}`
}

function hasMemberAgeGateColumn(database: DatabaseSync): boolean {
  const columns = database.prepare('PRAGMA table_info(member)').all() as Array<{
    name: string
  }>
  return columns.some((column) => column.name === 'age_gate_status')
}

export function searchMembers(
  database: DatabaseSync,
  tenantId: string,
  query: string,
  limit: number
): MemberRecord[] {
  const normalized = query.trim()
  const pattern = `%${normalized.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
  const rows = database
    .prepare(
      `${memberSelectSql(database)}
       WHERE m.tenant_id = ?
         AND (? = '' OR m.phone LIKE ? ESCAPE '\\'
          OR m.member_number LIKE ? ESCAPE '\\'
          OR m.nickname LIKE ? ESCAPE '\\')
       GROUP BY m.id
       ORDER BY m.updated_at DESC
       LIMIT ?`
    )
    .all(tenantId, normalized, pattern, pattern, pattern, limit) as Record<string, unknown>[]
  return rows.map(mapMember)
}

export function listCashierMembers(
  database: DatabaseSync,
  tenantId: string
): CashierMemberRecord[] {
  const rows = database
    .prepare(
      `WITH member_activity AS (
         SELECT member_id, MAX(occurred_at) last_active_at
         FROM (
           SELECT customer_member_id member_id, completed_at occurred_at
           FROM sales_order
           WHERE tenant_id = ? AND customer_member_id IS NOT NULL
           UNION ALL
           SELECT wallet_member_id member_id, completed_at occurred_at
           FROM sales_order
           WHERE tenant_id = ? AND wallet_member_id IS NOT NULL
           UNION ALL
           SELECT member_id, occurred_at
           FROM wallet_ledger
           WHERE tenant_id = ?
           UNION ALL
           SELECT member_id, occurred_at
           FROM monthly_card_event
           WHERE tenant_id = ?
         )
         GROUP BY member_id
       )
       SELECT m.id, m.member_number, m.phone, m.nickname, m.status,
              m.birthday_month, m.birthday_day, m.birthday_source, m.note, m.source,
              ${memberAgeGateSelectSql(database)},
              m.created_at, m.updated_at, a.last_active_at,
              COUNT(CASE WHEN g.id IS NOT NULL AND g.revoked_at IS NULL THEN 1 END)
                AS advanced_grants
       FROM member m
       LEFT JOIN membership_grant g ON g.member_id = m.id
       LEFT JOIN member_activity a ON a.member_id = m.id
       WHERE m.tenant_id = ? AND m.status = 'active'
       GROUP BY m.id
       ORDER BY a.last_active_at IS NULL, a.last_active_at DESC, m.updated_at DESC`
    )
    .all(tenantId, tenantId, tenantId, tenantId, tenantId) as Record<string, unknown>[]
  return rows.map((row) => ({
    ...mapMember(row),
    lastActiveAt:
      row.last_active_at === null || row.last_active_at === undefined
        ? null
        : String(row.last_active_at)
  }))
}

export function createMember(
  database: DatabaseSync,
  context: MemberWriteContext,
  input: {
    phone: string
    nickname: string
    confirmedAtLeast14: boolean
    birthdayMonth?: number
    birthdayDay?: number
    note?: string
  }
): MemberRecord {
  if (!input.confirmedAtLeast14) {
    throw new Error('Members under 14 are not supported in the first release')
  }
  const birthdayProvided =
    input.birthdayMonth !== undefined || input.birthdayDay !== undefined
  if (birthdayProvided) {
    if (input.birthdayMonth === undefined || input.birthdayDay === undefined) {
      throw new Error('Member birthday month and day must be provided together')
    }
    if (!validCalendarDate(input.birthdayMonth, input.birthdayDay)) {
      throw new Error('Birthday month and day are invalid')
    }
  }

  const timestamp = new Date().toISOString()
  const birthdayMonth = birthdayProvided ? input.birthdayMonth ?? null : null
  const birthdayDay = birthdayProvided ? input.birthdayDay ?? null : null
  const birthdaySource = birthdayProvided ? 'customer' : null
  const note = input.note?.trim() || null

  database.exec('BEGIN IMMEDIATE')
  try {
    const existing = findMemberByPhone(database, context.tenantId, input.phone)
    if (existing) {
      if (existing.status === 'active') {
        throw new Error('Member phone already exists')
      }
      if (context.actor.role !== 'manager') {
        throw new Error('Only managers can restore disabled members')
      }

      database
        .prepare(
          `UPDATE membership_grant
           SET revoked_by = ?, revoked_at = ?, revoke_reason = ?
           WHERE tenant_id = ? AND member_id = ? AND revoked_at IS NULL`
        )
        .run(
          context.actor.id,
          timestamp,
          'member restored and profile reset',
          context.tenantId,
          existing.id
        )
      if (hasMemberAgeGateColumn(database)) {
        database
          .prepare(
            `UPDATE member
             SET nickname = ?, status = 'active', birthday_month = ?,
                 birthday_day = ?, birthday_source = ?, birthday_locked = ?,
                 confirmed_at_least_14 = 1,
                 age_gate_status = 'confirmed_at_least_14',
                 note = ?, source = 'desktop', updated_at = ?
             WHERE id = ? AND tenant_id = ?`
          )
          .run(
            input.nickname,
            birthdayMonth,
            birthdayDay,
            birthdaySource,
            birthdayProvided ? 1 : 0,
            note,
            timestamp,
            existing.id,
            context.tenantId
          )
      } else {
        database
          .prepare(
            `UPDATE member
             SET nickname = ?, status = 'active', birthday_month = ?,
                 birthday_day = ?, birthday_source = ?, birthday_locked = ?,
                 confirmed_at_least_14 = 1,
                 note = ?, source = 'desktop', updated_at = ?
             WHERE id = ? AND tenant_id = ?`
          )
          .run(
            input.nickname,
            birthdayMonth,
            birthdayDay,
            birthdaySource,
            birthdayProvided ? 1 : 0,
            note,
            timestamp,
            existing.id,
            context.tenantId
          )
      }
      const restored = findMemberById(database, context.tenantId, existing.id)
      appendMemberAuditAndOutbox(database, context, {
        action: 'member.enabled',
        operationType: 'member.enabled',
        memberId: existing.id,
        reason: 'desktop member re-registration',
        before: existing,
        after: restored
      })
      database.exec('COMMIT')
      return restored
    }

    const id = randomUUID()
    const memberNumber = nextMemberNumber(id)
    const record: MemberRecord = {
      id,
      memberNumber,
      phone: input.phone,
      nickname: input.nickname,
      tier: 'ordinary',
      status: 'active',
      birthdayMonth,
      birthdayDay,
      birthdaySource,
      note,
      source: 'desktop',
      ageGate: 'confirmed_at_least_14',
      createdAt: timestamp,
      updatedAt: timestamp
    }

    if (hasMemberAgeGateColumn(database)) {
      database
        .prepare(
          `INSERT INTO member
           (id, tenant_id, store_id, member_number, phone, nickname, status,
            birthday_month, birthday_day, birthday_source, birthday_locked,
            confirmed_at_least_14, age_gate_status, note, source,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 1,
                   'confirmed_at_least_14', ?, 'desktop', ?, ?)`
        )
        .run(
          id,
          context.tenantId,
          context.storeId,
          memberNumber,
          input.phone,
          input.nickname,
          birthdayMonth,
          birthdayDay,
          birthdaySource,
          birthdayProvided ? 1 : 0,
          note,
          timestamp,
          timestamp
        )
    } else {
      database
        .prepare(
          `INSERT INTO member
           (id, tenant_id, store_id, member_number, phone, nickname, status,
            birthday_month, birthday_day, birthday_source, birthday_locked,
            confirmed_at_least_14, note, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 1,
                   ?, 'desktop', ?, ?)`
        )
        .run(
          id,
          context.tenantId,
          context.storeId,
          memberNumber,
          input.phone,
          input.nickname,
          birthdayMonth,
          birthdayDay,
          birthdaySource,
          birthdayProvided ? 1 : 0,
          note,
          timestamp,
          timestamp
        )
    }
    appendMemberAuditAndOutbox(database, context, {
      action: 'member.created',
      operationType: 'member.created',
      memberId: id,
      reason: 'desktop member registration',
      before: null,
      after: record
    })
    database.exec('COMMIT')
    return record
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function disableMember(
  database: DatabaseSync,
  context: MemberWriteContext,
  input: {
    memberId: string
    reason: string
  }
): MemberRecord {
  if (context.actor.role !== 'manager') {
    throw new Error('Only managers can disable members')
  }
  const before = findMemberById(database, context.tenantId, input.memberId)
  if (before.status === 'disabled') {
    return before
  }

  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `UPDATE member
         SET status = 'disabled', updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .run(timestamp, input.memberId, context.tenantId)
    const after = findMemberById(database, context.tenantId, input.memberId)
    appendMemberAuditAndOutbox(database, context, {
      action: 'member.disabled',
      operationType: 'member.disabled',
      memberId: input.memberId,
      reason: input.reason,
      before,
      after
    })
    database.exec('COMMIT')
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function adjustMemberTier(
  database: DatabaseSync,
  context: MemberWriteContext,
  input: {
    memberId: string
    tier: 'ordinary' | 'advanced'
    reason: string
  }
): MemberRecord {
  const before = findMemberById(database, context.tenantId, input.memberId)
  if (before.tier === input.tier) {
    return before
  }

  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    if (input.tier === 'advanced') {
      database
        .prepare(
          `INSERT INTO membership_grant
           (id, tenant_id, store_id, member_id, source_type, source_id, granted_tier,
            reason, granted_by, granted_at)
           VALUES (?, ?, ?, ?, 'manual', ?, 'advanced', ?, ?, ?)`
        )
        .run(
          randomUUID(),
          context.tenantId,
          context.storeId,
          input.memberId,
          randomUUID(),
          input.reason,
          context.actor.id,
          timestamp
        )
    } else {
      database
        .prepare(
          `UPDATE membership_grant
           SET revoked_by = ?, revoked_at = ?, revoke_reason = ?
           WHERE tenant_id = ? AND member_id = ? AND revoked_at IS NULL`
        )
        .run(
          context.actor.id,
          timestamp,
          input.reason,
          context.tenantId,
          input.memberId
        )
    }
    database
      .prepare('UPDATE member SET updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(timestamp, input.memberId, context.tenantId)
    const after = findMemberById(database, context.tenantId, input.memberId)
    appendMemberAuditAndOutbox(database, context, {
      action: 'member.tier.adjusted',
      operationType: 'member.tier.adjusted',
      memberId: input.memberId,
      reason: input.reason,
      before,
      after
    })
    database.exec('COMMIT')
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function validCalendarDate(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) {
    return false
  }
  const maximumDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const maximum = maximumDays[month - 1]
  return maximum !== undefined && day >= 1 && day <= maximum
}

export function correctMemberBirthday(
  database: DatabaseSync,
  context: MemberWriteContext,
  input: {
    memberId: string
    month: number
    day: number
    reason: string
  }
): MemberRecord {
  if (context.actor.role !== 'manager') {
    throw new Error('Only managers can correct member birthdays')
  }
  if (!validCalendarDate(input.month, input.day)) {
    throw new Error('Birthday month and day are invalid')
  }

  const before = findMemberById(database, context.tenantId, input.memberId)
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        `UPDATE member
         SET birthday_month = ?, birthday_day = ?, birthday_source = 'manager_correction',
             birthday_locked = 1, updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .run(input.month, input.day, timestamp, input.memberId, context.tenantId)
    const after = findMemberById(database, context.tenantId, input.memberId)
    appendMemberAuditAndOutbox(database, context, {
      action: 'member.birthday.corrected',
      operationType: 'member.birthday.corrected',
      memberId: input.memberId,
      reason: input.reason,
      before,
      after
    })
    database.exec('COMMIT')
    return after
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
