import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { EmployeeRecord, StoreContext } from './identity'

type TierContext = StoreContext & { actor?: EmployeeRecord }

function memberSnapshot(
  database: DatabaseSync,
  tenantId: string,
  memberId: string
): Record<string, unknown> {
  const row = database
    .prepare(
      `SELECT m.id, m.member_number, m.phone, m.nickname, m.status,
              m.birthday_month, m.birthday_day, m.birthday_source,
              m.note, m.source, m.age_gate_status, m.created_at, m.updated_at,
              COUNT(CASE WHEN grant_row.id IS NOT NULL
                               AND grant_row.revoked_at IS NULL
                         THEN 1 END) advanced_grants
       FROM member m
       LEFT JOIN membership_grant grant_row
         ON grant_row.tenant_id = m.tenant_id
        AND grant_row.member_id = m.id
       WHERE m.tenant_id = ? AND m.id = ?
       GROUP BY m.id`
    )
    .get(tenantId, memberId) as Record<string, unknown> | undefined
  if (!row) throw new Error('Member is missing for tier reconciliation')
  return {
    id: String(row.id),
    memberNumber: String(row.member_number),
    phone: String(row.phone),
    nickname: String(row.nickname),
    tier: Number(row.advanced_grants) > 0 ? 'advanced' : 'ordinary',
    status: row.status === 'active' ? 'active' : 'disabled',
    birthdayMonth:
      row.birthday_month === null ? null : Number(row.birthday_month),
    birthdayDay: row.birthday_day === null ? null : Number(row.birthday_day),
    birthdaySource:
      row.birthday_source === null ? null : String(row.birthday_source),
    note: row.note === null ? null : String(row.note),
    source: String(row.source),
    ageGate:
      row.age_gate_status === 'under_14_verified' ||
      row.age_gate_status === 'recharge_disabled'
        ? row.age_gate_status
        : 'confirmed_at_least_14',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

export function appendMemberTierReconciliationInOpenTransaction(
  database: DatabaseSync,
  context: TierContext,
  memberId: string,
  reason: string,
  occurredAt = new Date().toISOString()
): void {
  const after = {
    ...memberSnapshot(database, context.tenantId, memberId),
    updatedAt: occurredAt
  }
  const payload = JSON.stringify({
    action: 'member.tier.reconciled',
    memberId,
    before: null,
    after,
    reason
  })
  const sequence = database
    .prepare('SELECT next_sequence FROM device WHERE id = ?')
    .get(context.deviceId) as { next_sequence: number } | undefined
  if (!sequence) throw new Error('Registered device is missing')
  database
    .prepare(
      `UPDATE device SET next_sequence = next_sequence + 1, updated_at = ?
       WHERE id = ?`
    )
    .run(occurredAt, context.deviceId)
  database
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, 'member.tier.reconciled', 'member', ?, ?,
               NULL, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actor?.id ?? null,
      memberId,
      reason,
      JSON.stringify(after),
      occurredAt
    )
  database
    .prepare(
      `INSERT INTO outbox_operation
       (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
        operation_type, aggregate_id, base_version, occurred_at, payload_json,
        payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, 'member.tier.reconciled', ?, NULL, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.deviceId,
      sequence.next_sequence,
      context.tenantId,
      context.storeId,
      context.actor?.id ?? null,
      memberId,
      occurredAt,
      payload,
      createHash('sha256').update(payload).digest('hex')
    )
}

export function ensureMemberTierReconciliationOutbox(
  database: DatabaseSync,
  context: StoreContext
): { created: number } {
  const marker = 'system.member_tier_reconciliation_v1'
  const existing = database
    .prepare(
      `SELECT 1 FROM audit_log
       WHERE tenant_id = ? AND device_id = ? AND action = ? LIMIT 1`
    )
    .get(context.tenantId, context.deviceId, marker)
  if (existing) return { created: 0 }
  const members = database
    .prepare(`SELECT id FROM member WHERE tenant_id = ? ORDER BY id`)
    .all(context.tenantId) as Array<{ id: string }>
  const timestamp = new Date().toISOString()
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const member of members) {
      appendMemberTierReconciliationInOpenTransaction(
        database,
        context,
        member.id,
        '历史会员等级云端对账',
        timestamp
      )
    }
    database
      .prepare(
        `INSERT INTO audit_log
         (id, tenant_id, store_id, device_id, actor_id, action,
          aggregate_type, aggregate_id, reason, before_json, after_json,
          occurred_at)
         VALUES (?, ?, ?, ?, NULL, ?, 'system_operation', ?, ?,
                 NULL, ?, ?)`
      )
      .run(
        randomUUID(),
        context.tenantId,
        context.storeId,
        context.deviceId,
        marker,
        context.deviceId,
        '已排队当前会员等级投影',
        JSON.stringify({ created: members.length }),
        timestamp
      )
    database.exec('COMMIT')
    return { created: members.length }
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
