import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { StoreContext } from './identity'
import { listActivities } from './activity'
import { listAnnouncements } from './announcement'
import { listBoardGames } from './board-game'
import { listCatalogItems } from './catalog'
import { getRechargeGiftTiers } from './wallet'

export type CloudBaselineResult = {
  created: number
  byType: Record<string, number>
}

function existingAggregates(
  database: DatabaseSync,
  deviceId: string,
  predicate: string
): Set<string> {
  const rows = database
    .prepare(
      `SELECT DISTINCT aggregate_id
       FROM outbox_operation
       WHERE device_id = ? AND (${predicate})`
    )
    .all(deviceId) as Array<{ aggregate_id: string }>
  return new Set(rows.map((row) => row.aggregate_id))
}

export function ensureCloudBaselineOutbox(
  database: DatabaseSync,
  context: StoreContext,
  actorId: string,
  now = new Date()
): CloudBaselineResult {
  const timestamp = now.toISOString()
  const employeesWithState = existingAggregates(
    database,
    context.deviceId,
    `operation_type LIKE 'employee.%'
     AND operation_type NOT IN (
       'employee.password.changed', 'employee.mobile_access.updated'
     )`
  )
  const employeeMobileAccessWithState = existingAggregates(
    database,
    context.deviceId,
    "operation_type = 'employee.mobile_access.updated'"
  )
  const membersWithState = existingAggregates(
    database,
    context.deviceId,
    "operation_type LIKE 'member.%'"
  )
  const catalogWithState = existingAggregates(
    database,
    context.deviceId,
    "operation_type LIKE 'catalog.%'"
  )
  const activitiesWithState = existingAggregates(
    database,
    context.deviceId,
    "operation_type LIKE 'activity.%'"
  )
  const announcementsWithState = existingAggregates(
    database,
    context.deviceId,
    "operation_type LIKE 'announcement.%'"
  )
  const boardGamesWithState = existingAggregates(
    database,
    context.deviceId,
    "operation_type LIKE 'board_game.%'"
  )
  const walletsWithState = existingAggregates(
    database,
    context.deviceId,
    `operation_type IN (
      'wallet.cash_recharged', 'wallet.debited',
      'wallet.order_refund_credited', 'wallet.cash_recharge_reversed',
      'wallet.snapshot'
    )`
  )
  const monthlyCardsWithState = existingAggregates(
    database,
    context.deviceId,
    "operation_type LIKE 'monthly_card.%'"
  )
  const hasGiftTierState = database
    .prepare(
      `SELECT 1 FROM outbox_operation
       WHERE device_id = ? AND operation_type = 'wallet.gift_tiers.updated'
       LIMIT 1`
    )
    .get(context.deviceId)

  const catalogItems = listCatalogItems(database, context)
  const activities = listActivities(database, context, now)
  const announcements = listAnnouncements(database, context, now)
  const boardGames = listBoardGames(database, context)
  const giftTiers = getRechargeGiftTiers(database, context)
  const employees = database
    .prepare(
      `SELECT e.id, e.username, e.display_name, e.role, e.status,
              e.created_at, e.updated_at, c.enabled mobile_access_enabled,
              c.password_hash mobile_password_hash,
              c.updated_at mobile_updated_at
       FROM employee e
       LEFT JOIN employee_mobile_credential c ON c.employee_id = e.id
       WHERE e.tenant_id = ? AND e.store_id = ?
       ORDER BY e.created_at, e.id`
    )
    .all(context.tenantId, context.storeId) as Array<Record<string, unknown>>
  const members = database
    .prepare(
      `SELECT m.id, m.member_number, m.phone, m.nickname, m.status,
              m.birthday_month, m.birthday_day, m.birthday_source, m.note,
              m.source, m.age_gate_status, m.created_at, m.updated_at,
              COUNT(CASE WHEN g.id IS NOT NULL AND g.revoked_at IS NULL
                         THEN 1 END) advanced_grants
       FROM member m
       LEFT JOIN membership_grant g
         ON g.tenant_id = m.tenant_id AND g.member_id = m.id
       WHERE m.tenant_id = ? AND m.store_id = ?
       GROUP BY m.id
       ORDER BY m.created_at, m.id`
    )
    .all(context.tenantId, context.storeId) as Array<Record<string, unknown>>
  const wallets = database
    .prepare(
      `SELECT id, member_id, status, principal_balance_fen,
              gift_balance_fen, created_at, updated_at
       FROM wallet_account
       WHERE tenant_id = ? AND store_id = ?
       ORDER BY created_at, id`
    )
    .all(context.tenantId, context.storeId) as Array<Record<string, unknown>>
  const monthlyCards = database
    .prepare(
      `SELECT c.id, c.member_id, c.plan_name_snapshot, c.price_fen,
              c.payment_method, c.status, c.purchased_at, c.starts_at,
              c.expires_at, c.paused_at, c.updated_at,
              (SELECT COUNT(*) FROM monthly_card_event e
               WHERE e.tenant_id = c.tenant_id AND e.card_id = c.id
                 AND e.event_type = 'used') usage_count
       FROM monthly_card c
       WHERE c.tenant_id = ? AND c.store_id = ?
       ORDER BY c.purchased_at, c.id`
    )
    .all(context.tenantId, context.storeId) as Array<Record<string, unknown>>

  const sequence = database
    .prepare('SELECT next_sequence FROM device WHERE id = ?')
    .get(context.deviceId) as { next_sequence: number } | undefined
  if (!sequence) throw new Error('Registered device is missing')

  let nextSequence = sequence.next_sequence
  const byType: Record<string, number> = {}
  const insert = database.prepare(
    `INSERT INTO outbox_operation
     (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
      operation_type, aggregate_id, base_version, occurred_at, payload_json,
      payload_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  )
  const append = (
    operationType: string,
    aggregateId: string,
    payloadValue: unknown
  ): void => {
    const payload = JSON.stringify(payloadValue)
    insert.run(
      randomUUID(),
      context.deviceId,
      nextSequence,
      context.tenantId,
      context.storeId,
      actorId,
      operationType,
      aggregateId,
      timestamp,
      payload,
      createHash('sha256').update(payload).digest('hex')
    )
    nextSequence += 1
    byType[operationType] = (byType[operationType] ?? 0) + 1
  }

  database.exec('BEGIN IMMEDIATE')
  try {
    for (const employee of employees) {
      const id = String(employee.id)
      if (!employeesWithState.has(id)) {
        const after = {
          id,
          username: String(employee.username),
          displayName: String(employee.display_name),
          role: employee.role === 'manager' ? 'manager' : 'staff',
          status: employee.status === 'active' ? 'active' : 'disabled',
          createdAt: String(employee.created_at),
          updatedAt: String(employee.updated_at)
        }
        append('employee.snapshot', id, {
          action: 'employee.snapshot',
          aggregateId: id,
          before: null,
          after,
          reason: '首次云端连接基线'
        })
      }
      if (
        Number(employee.mobile_access_enabled) === 1 &&
        employee.mobile_password_hash &&
        !employeeMobileAccessWithState.has(id)
      ) {
        append('employee.mobile_access.updated', id, {
          action: 'employee.mobile_access.enabled',
          aggregateId: id,
          before: null,
          after: {
            employeeId: id,
            enabled: true,
            passwordHash: String(employee.mobile_password_hash),
            updatedAt: String(employee.mobile_updated_at)
          },
          reason: '首次云端连接移动登录基线'
        })
      }
    }
    for (const member of members) {
      const id = String(member.id)
      if (membersWithState.has(id)) continue
      const after = {
        id,
        memberNumber: String(member.member_number),
        phone: String(member.phone),
        nickname: String(member.nickname),
        tier: Number(member.advanced_grants) > 0 ? 'advanced' : 'ordinary',
        status: member.status === 'active' ? 'active' : 'disabled',
        birthdayMonth:
          member.birthday_month === null
            ? null
            : Number(member.birthday_month),
        birthdayDay:
          member.birthday_day === null ? null : Number(member.birthday_day),
        birthdaySource:
          member.birthday_source === null
            ? null
            : String(member.birthday_source),
        note: member.note === null ? null : String(member.note),
        source: String(member.source),
        ageGate:
          member.age_gate_status === 'under_14_verified' ||
          member.age_gate_status === 'recharge_disabled'
            ? member.age_gate_status
            : 'confirmed_at_least_14',
        createdAt: String(member.created_at),
        updatedAt: String(member.updated_at)
      }
      append('member.snapshot', id, {
        action: 'member.snapshot',
        memberId: id,
        before: null,
        after,
        reason: '首次云端连接基线'
      })
    }
    for (const item of catalogItems) {
      if (catalogWithState.has(item.id)) continue
      append('catalog.snapshot', item.id, {
        action: 'catalog.snapshot',
        itemId: item.id,
        before: null,
        after: item,
        reason: '首次云端连接基线'
      })
    }
    for (const activity of activities) {
      if (activitiesWithState.has(activity.id)) continue
      append('activity.snapshot', activity.id, {
        action: 'activity.snapshot',
        activityId: activity.id,
        before: null,
        after: activity,
        reason: '首次云端连接基线'
      })
    }
    for (const announcement of announcements) {
      if (announcementsWithState.has(announcement.id)) continue
      append('announcement.snapshot', announcement.id, {
        action: 'announcement.snapshot',
        announcementId: announcement.id,
        before: null,
        after: announcement,
        reason: '首次云端连接基线'
      })
    }
    for (const game of boardGames) {
      if (boardGamesWithState.has(game.id)) continue
      append('board_game.snapshot', game.id, {
        action: 'board_game.snapshot',
        boardGameId: game.id,
        before: null,
        after: game,
        reason: '首次云端连接基线'
      })
    }
    if (!hasGiftTierState) {
      append('wallet.gift_tiers.updated', context.storeId, {
        action: 'wallet.gift_tiers.updated',
        aggregateId: context.storeId,
        before: [],
        after: giftTiers,
        reason: '首次云端连接基线'
      })
    }
    for (const wallet of wallets) {
      const id = String(wallet.id)
      if (walletsWithState.has(id)) continue
      const principalBalanceFen = Number(wallet.principal_balance_fen)
      const giftBalanceFen = Number(wallet.gift_balance_fen)
      append('wallet.snapshot', id, {
        action: 'wallet.snapshot',
        aggregateId: id,
        before: null,
        after: {
          operationId: `snapshot:${id}`,
          wallet: {
            accountId: id,
            memberId: String(wallet.member_id),
            principalBalanceFen,
            giftBalanceFen,
            totalBalanceFen: principalBalanceFen + giftBalanceFen,
            status: wallet.status === 'frozen' ? 'frozen' : 'active',
            updatedAt: String(wallet.updated_at)
          },
          principalDeltaFen: principalBalanceFen,
          giftDeltaFen: giftBalanceFen
        },
        reason: '首次云端连接基线'
      })
    }
    for (const card of monthlyCards) {
      const id = String(card.id)
      if (monthlyCardsWithState.has(id)) continue
      const storedStatus = String(card.status)
      const status =
        storedStatus === 'active' &&
        new Date(String(card.expires_at)).getTime() <= now.getTime()
          ? 'expired'
          : storedStatus
      append('monthly_card.snapshot', id, {
        action: 'monthly_card.snapshot',
        cardId: id,
        before: null,
        after: {
          id,
          memberId: String(card.member_id),
          planName: String(card.plan_name_snapshot),
          priceFen: Number(card.price_fen),
          paymentMethod:
            card.payment_method === 'wechat' ? 'wechat' : 'cash',
          status,
          purchasedAt: String(card.purchased_at),
          startsAt: String(card.starts_at),
          expiresAt: String(card.expires_at),
          pausedAt:
            card.paused_at === null ? null : String(card.paused_at),
          usageCount: Number(card.usage_count)
        },
        reason: '首次云端连接基线'
      })
    }

    const created = nextSequence - sequence.next_sequence
    if (created > 0) {
      database
        .prepare(
          `UPDATE device
           SET next_sequence = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(nextSequence, timestamp, context.deviceId)
      database
        .prepare(
          `INSERT INTO audit_log
           (id, tenant_id, store_id, device_id, actor_id, action,
            aggregate_type, aggregate_id, reason, before_json, after_json,
            occurred_at)
           VALUES (?, ?, ?, ?, ?, 'system.cloud.baseline_prepared',
                   'system_operation', ?, '首次云端连接补齐缺失基线',
                   NULL, ?, ?)`
        )
        .run(
          randomUUID(),
          context.tenantId,
          context.storeId,
          context.deviceId,
          actorId,
          context.deviceId,
          JSON.stringify({ created, byType }),
          timestamp
        )
    }
    database.exec('COMMIT')
    return { created, byType }
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
