import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { StoreContext } from './identity'

export function reconcileProjectedMemberTier(
  database: DatabaseSync,
  context: StoreContext,
  input: {
    memberId: string
    sourceStoreId: string
    tier: 'ordinary' | 'advanced'
    source: string
    occurredAt: string
  }
): void {
  const sourceId = `cloud-member-tier:${input.memberId}`
  if (input.tier === 'ordinary') {
    database
      .prepare(
        `UPDATE membership_grant
         SET revoked_by = 'cloud-sync', revoked_at = ?,
             revoke_reason = '云端会员等级投影已恢复为普通会员'
         WHERE tenant_id = ? AND member_id = ? AND source_id = ?
           AND revoked_at IS NULL`
      )
      .run(
        input.occurredAt,
        context.tenantId,
        input.memberId,
        sourceId
      )
    return
  }

  const activeGrant = database
    .prepare(
      `SELECT 1 FROM membership_grant
       WHERE tenant_id = ? AND member_id = ? AND revoked_at IS NULL
       LIMIT 1`
    )
    .get(context.tenantId, input.memberId)
  if (activeGrant) return
  database
    .prepare(
      `INSERT INTO membership_grant
       (id, tenant_id, store_id, member_id, source_type, source_id,
        granted_tier, reason, granted_by, granted_at)
       VALUES (?, ?, ?, ?, ?, ?, 'advanced', ?, 'cloud-sync', ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      input.sourceStoreId,
      input.memberId,
      input.source === 'legacy' ? 'legacy' : 'manual',
      sourceId,
      input.source === 'legacy'
        ? '旧库导入高级会员云端投影'
        : '云端会员等级投影',
      input.occurredAt
    )
}
