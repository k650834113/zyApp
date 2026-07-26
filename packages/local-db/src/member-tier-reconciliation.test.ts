import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  adjustMemberTier,
  bootstrapStore,
  createMember,
  ensureMemberTierReconciliationOutbox,
  findEmployeeRecordById,
  getStoreContext,
  openLocalDatabase
} from './index'

describe('member tier reconciliation', () => {
  it('queues one authoritative snapshot per member only once', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-tier-reconcile-'))
    const local = openLocalDatabase(join(directory, 'test.db'))
    try {
      const bootstrap = bootstrapStore(local.connection, {
        storeName: 'Tier Store',
        managerUsername: 'manager',
        managerPasswordHash: 'scrypt$manager',
        managerDisplayName: 'Manager',
        deviceName: 'Cashier'
      })
      const context = getStoreContext(local.connection)
      if (!context) throw new Error('Missing store context')
      const manager = findEmployeeRecordById(
        local.connection,
        context.tenantId,
        bootstrap.managerId
      )
      if (!manager) throw new Error('Missing manager')
      const member = createMember(
        local.connection,
        { ...context, actor: manager },
        {
          phone: '13800138099',
          nickname: '等级对账',
          confirmedAtLeast14: true
        }
      )
      adjustMemberTier(
        local.connection,
        { ...context, actor: manager },
        { memberId: member.id, tier: 'advanced', reason: '人工高级资格' }
      )

      const first = ensureMemberTierReconciliationOutbox(
        local.connection,
        context
      )
      const second = ensureMemberTierReconciliationOutbox(
        local.connection,
        context
      )

      expect(first).toEqual({ created: 1 })
      expect(second).toEqual({ created: 0 })
      const payload = local.connection
        .prepare(
          `SELECT actor_id, payload_json FROM outbox_operation
           WHERE operation_type = 'member.tier.reconciled'
             AND aggregate_id = ?
           ORDER BY device_seq DESC LIMIT 1`
        )
        .get(member.id) as { actor_id: string; payload_json: string }
      expect(payload.actor_id).toBe(bootstrap.managerId)
      expect(JSON.parse(payload.payload_json)).toEqual({
        action: 'member.tier.reconciled',
        memberId: member.id,
        before: null,
        after: {
          tier: 'advanced',
          updatedAt: expect.any(String)
        },
        reason: '历史会员等级云端对账'
      })
    } finally {
      local.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('does not queue reconciliation when the store has no active employee', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-tier-reconcile-no-actor-'))
    const local = openLocalDatabase(join(directory, 'test.db'))
    try {
      const bootstrap = bootstrapStore(local.connection, {
        storeName: 'No Actor Store',
        managerUsername: 'manager',
        managerPasswordHash: 'scrypt$manager',
        managerDisplayName: 'Manager',
        deviceName: 'Cashier'
      })
      const context = getStoreContext(local.connection)
      if (!context) throw new Error('Missing store context')
      local.connection
        .prepare("UPDATE employee SET status = 'disabled' WHERE id = ?")
        .run(bootstrap.managerId)

      expect(ensureMemberTierReconciliationOutbox(local.connection, context)).toEqual({
        created: 0
      })
      const pendingTierCount = local.connection
        .prepare(
          `SELECT COUNT(*) AS count FROM outbox_operation
           WHERE operation_type = 'member.tier.reconciled'`
        )
        .get() as { count: number }
      const systemMarkerCount = local.connection
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_log
           WHERE tenant_id = ? AND device_id = ?
             AND action = 'system.member_tier_reconciliation_v1'`
        )
        .get(context.tenantId, context.deviceId) as { count: number }
      expect(pendingTierCount.count).toBe(0)
      expect(systemMarkerCount.count).toBe(0)
    } finally {
      local.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
