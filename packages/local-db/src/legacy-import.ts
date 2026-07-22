import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  LegacyCatalogImportConflict,
  LegacyCatalogImportResolution,
  LegacyImportResult,
  LegacyImportSummary,
  LegacyMemberImportCandidate,
  LegacyMemberImportResolution
} from '@zyapp/contracts'
import type { EmployeeRecord, StoreContext } from './identity'

type LegacyImportContext = StoreContext & {
  actor: EmployeeRecord
}

type LegacySourceMetadata = {
  sourceName: string
  sourceSha256: string
  sourceSizeBytes: number
}

type LegacyMemberRow = {
  id: string
  name: string
  phone: string
  birthday: string | null
  joinDate: string | null
  balance: number
  status: string
  subscription_plan_name: string | null
  subscription_start_date: string | null
  subscription_end_date: string | null
  created_at: string | null
  updated_at: string | null
}

type LegacyTransactionRow = {
  id: string
  member_id: string
  type: string
  amount: number
  date: string | null
  notes: string | null
  created_at: string | null
}

type LegacyActivityRow = {
  id: string
  member_id: string | null
  member_name: string | null
  action_type: string
  amount: number | null
  description: string | null
  created_at: string | null
}

type LegacyCatalogRow = {
  id: string
  name: string
  priceRegular: number
  priceVip: number
  created_at: string | null
}

type CurrentMemberRow = {
  id: string
  nickname: string
  birthday_month: number | null
  birthday_day: number | null
  current_tier: 'ordinary' | 'advanced'
  principal_balance_fen: number
  gift_balance_fen: number
  monthly_card_status: 'active' | 'paused' | null
}

type LegacyRows = {
  members: LegacyMemberRow[]
  transactions: LegacyTransactionRow[]
  activityLogs: LegacyActivityRow[]
  catalogItems: LegacyCatalogRow[]
}

export type LegacyDatabaseInspection = {
  sourceName: string
  sourceSha256: string
  sourceSizeBytes: number
  alreadyImported: boolean
  summary: LegacyImportSummary
  memberConflicts: LegacyMemberImportCandidate[]
  catalogConflicts: LegacyCatalogImportConflict[]
  warnings: string[]
  assumptions: string[]
}

export type LegacyImportCloudSyncResult = {
  batches: number
  created: number
  byType: Record<string, number>
}

const REQUIRED_COLUMNS = {
  members: [
    'id',
    'name',
    'phone',
    'birthday',
    'joinDate',
    'balance',
    'status',
    'subscription_plan_name',
    'subscription_start_date',
    'subscription_end_date',
    'created_at',
    'updated_at'
  ],
  transactions: ['id', 'member_id', 'type', 'amount', 'date', 'notes', 'created_at'],
  activity_logs: [
    'id',
    'member_id',
    'member_name',
    'action_type',
    'amount',
    'description',
    'created_at'
  ],
  quick_deduct_items: ['id', 'name', 'priceRegular', 'priceVip', 'created_at']
} as const

function requireLegacySchema(source: DatabaseSync): void {
  const integrityRows = source.prepare('PRAGMA integrity_check').all() as Array<
    Record<string, unknown>
  >
  if (
    integrityRows.length !== 1 ||
    String(integrityRows[0]?.integrity_check ?? '') !== 'ok'
  ) {
    throw new Error('旧数据库完整性校验失败，不能导入')
  }
  const foreignKeyRows = source.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeyRows.length > 0) {
    throw new Error('旧数据库存在外键异常，不能导入')
  }

  for (const [table, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const columns = new Set(
      (
        source.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
          name: string
        }>
      ).map((column) => column.name)
    )
    if (columns.size === 0) {
      throw new Error(`旧数据库缺少必需数据表：${table}`)
    }
    const missing = requiredColumns.filter((column) => !columns.has(column))
    if (missing.length > 0) {
      throw new Error(`旧数据库表 ${table} 缺少字段：${missing.join('、')}`)
    }
  }
}

function readLegacyRows(source: DatabaseSync): LegacyRows {
  requireLegacySchema(source)
  return {
    members: source.prepare('SELECT * FROM members ORDER BY rowid').all() as LegacyMemberRow[],
    transactions: source
      .prepare('SELECT * FROM transactions ORDER BY rowid')
      .all() as LegacyTransactionRow[],
    activityLogs: source
      .prepare('SELECT * FROM activity_logs ORDER BY rowid')
      .all() as LegacyActivityRow[],
    catalogItems: source
      .prepare('SELECT * FROM quick_deduct_items ORDER BY rowid')
      .all() as LegacyCatalogRow[]
  }
}

function yuanToFen(value: number, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName}不是有效的非负金额`)
  }
  const fen = Math.round(value * 100)
  if (
    !Number.isSafeInteger(fen) ||
    Math.abs(fen / 100 - value) > 0.000_001
  ) {
    throw new Error(`${fieldName}不能无损转换为整数分`)
  }
  return fen
}

function parseBirthday(value: string | null): {
  month: number
  day: number
  text: string
} | null {
  const normalized = value?.trim()
  if (!normalized) return null
  const match = /^(\d{2})-(\d{2})$/.exec(normalized)
  if (!match) throw new Error(`旧会员生日格式不正确：${normalized}`)
  const month = Number(match[1])
  const day = Number(match[2])
  const maximum = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ]
  if (maximum === undefined || day < 1 || day > maximum) {
    throw new Error(`旧会员生日日期无效：${normalized}`)
  }
  return { month, day, text: normalized }
}

function normalizeLegacyTimestamp(
  value: string | null,
  fieldName: string,
  endOfDay = false
): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${fieldName}为空`)

  let candidate = normalized
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    candidate += endOfDay ? 'T23:59:59.999+08:00' : 'T00:00:00.000+08:00'
  } else if (
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(candidate)
  ) {
    const [base = '', fraction = ''] = candidate.replace(' ', 'T').split('.')
    candidate = fraction
      ? `${base}.${fraction.padEnd(3, '0').slice(0, 3)}+08:00`
      : `${base}.000+08:00`
  }
  const timestamp = new Date(candidate)
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`${fieldName}时间格式不正确：${normalized}`)
  }
  return timestamp.toISOString()
}

function normalizeOptionalTimestamp(value: string | null): string | null {
  if (!value?.trim()) return null
  return normalizeLegacyTimestamp(value, '旧记录时间')
}

function birthdayText(month: number | null, day: number | null): string | null {
  if (month === null || day === null) return null
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function currentMemberByPhone(
  target: DatabaseSync,
  tenantId: string
): Map<string, CurrentMemberRow> {
  const rows = target
    .prepare(
      `SELECT m.id, m.phone, m.nickname, m.birthday_month, m.birthday_day,
              CASE WHEN EXISTS (
                SELECT 1 FROM membership_grant g
                WHERE g.tenant_id = m.tenant_id AND g.member_id = m.id
                  AND g.revoked_at IS NULL
              ) THEN 'advanced' ELSE 'ordinary' END current_tier,
              COALESCE(w.principal_balance_fen, 0) principal_balance_fen,
              COALESCE(w.gift_balance_fen, 0) gift_balance_fen,
              (
                SELECT c.status FROM monthly_card c
                WHERE c.tenant_id = m.tenant_id AND c.member_id = m.id
                  AND c.status IN ('active', 'paused')
                ORDER BY c.purchased_at DESC LIMIT 1
              ) monthly_card_status
       FROM member m
       LEFT JOIN wallet_account w
         ON w.tenant_id = m.tenant_id AND w.member_id = m.id
       WHERE m.tenant_id = ?`
    )
    .all(tenantId) as Array<CurrentMemberRow & { phone: string }>
  return new Map(rows.map((row) => [row.phone, row]))
}

function validateLegacyRows(rows: LegacyRows): void {
  const phones = new Set<string>()
  const memberIds = new Set(rows.members.map((member) => member.id))
  for (const member of rows.members) {
    const phone = member.phone.trim()
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('旧数据库包含格式不正确的手机号')
    }
    if (phones.has(phone)) {
      throw new Error(`旧数据库存在重复手机号：${phone}`)
    }
    phones.add(phone)
    if (!member.name.trim()) throw new Error('旧数据库包含空会员昵称')
    if (member.status !== 'active' && member.status !== 'vip') {
      throw new Error(`旧数据库包含未知会员状态：${member.status}`)
    }
    yuanToFen(member.balance, '旧会员余额')
    parseBirthday(member.birthday)
    const subscriptionValues = [
      member.subscription_plan_name,
      member.subscription_start_date,
      member.subscription_end_date
    ].map((value) => Boolean(value?.trim()))
    if (
      subscriptionValues.some(Boolean) &&
      !subscriptionValues.every(Boolean)
    ) {
      throw new Error('旧数据库存在信息不完整的月卡记录')
    }
    if (subscriptionValues.every(Boolean)) {
      normalizeLegacyTimestamp(member.subscription_start_date, '月卡开始时间')
      normalizeLegacyTimestamp(member.subscription_end_date, '月卡结束时间', true)
    }
  }
  for (const transaction of rows.transactions) {
    if (!memberIds.has(transaction.member_id)) {
      throw new Error('旧数据库存在找不到会员的交易记录')
    }
    if (transaction.type !== 'top-up' && transaction.type !== 'deduction') {
      throw new Error(`旧数据库包含未知交易类型：${transaction.type}`)
    }
    yuanToFen(transaction.amount, '旧交易金额')
    normalizeOptionalTimestamp(transaction.date ?? transaction.created_at)
  }
  for (const activity of rows.activityLogs) {
    if (activity.member_id && !memberIds.has(activity.member_id)) {
      throw new Error('旧数据库存在找不到会员的活动日志')
    }
    if (activity.amount !== null) yuanToFen(activity.amount, '旧活动日志金额')
    normalizeOptionalTimestamp(activity.created_at)
  }
  for (const item of rows.catalogItems) {
    if (!item.name.trim()) throw new Error('旧数据库包含空收费项目名称')
    yuanToFen(item.priceRegular, '旧收费项目普通价')
    yuanToFen(item.priceVip, '旧收费项目高级会员价')
  }
}

function calculateReconciliationIssues(rows: LegacyRows): Map<string, number> {
  const totals = new Map<string, number>()
  for (const transaction of rows.transactions) {
    const amountFen = yuanToFen(transaction.amount, '旧交易金额')
    const signed = transaction.type === 'top-up' ? amountFen : -amountFen
    totals.set(transaction.member_id, (totals.get(transaction.member_id) ?? 0) + signed)
  }
  const differences = new Map<string, number>()
  for (const member of rows.members) {
    const balanceFen = yuanToFen(member.balance, '旧会员余额')
    const reconstructed = totals.get(member.id) ?? 0
    if (balanceFen !== reconstructed) {
      differences.set(member.id, balanceFen - reconstructed)
    }
  }
  return differences
}

function legacyMonthlyStatus(
  member: LegacyMemberRow,
  now: Date
): 'active' | 'expired' | null {
  if (!member.subscription_end_date?.trim()) return null
  return new Date(
    normalizeLegacyTimestamp(member.subscription_end_date, '月卡结束时间', true)
  ).getTime() > now.getTime()
    ? 'active'
    : 'expired'
}

export function inspectLegacyDatabase(
  source: DatabaseSync,
  target: DatabaseSync,
  context: StoreContext,
  metadata: LegacySourceMetadata,
  now = new Date()
): LegacyDatabaseInspection {
  const rows = readLegacyRows(source)
  validateLegacyRows(rows)
  const currentMembers = currentMemberByPhone(target, context.tenantId)
  const reconciliation = calculateReconciliationIssues(rows)
  const memberConflicts: LegacyMemberImportCandidate[] = []
  let matchedMembers = 0
  let activeMonthlyCards = 0
  let expiredMonthlyCards = 0

  for (const legacy of rows.members) {
    const monthlyStatus = legacyMonthlyStatus(legacy, now)
    if (monthlyStatus === 'active') activeMonthlyCards += 1
    if (monthlyStatus === 'expired') expiredMonthlyCards += 1
    const current = currentMembers.get(legacy.phone.trim())
    if (!current) continue
    matchedMembers += 1
    const legacyBirthday = parseBirthday(legacy.birthday)
    const currentBirthday = birthdayText(
      current.birthday_month,
      current.birthday_day
    )
    const conflicts: LegacyMemberImportCandidate['conflicts'] = []
    if (current.nickname.trim() !== legacy.name.trim()) conflicts.push('nickname')
    if (
      legacyBirthday &&
      currentBirthday &&
      legacyBirthday.text !== currentBirthday
    ) {
      conflicts.push('birthday')
    }
    if (legacy.balance > 0) conflicts.push('balance')
    if (monthlyStatus === 'active' && current.monthly_card_status) {
      conflicts.push('monthly_card')
    }
    if (conflicts.length === 0) continue
    memberConflicts.push({
      legacyId: legacy.id,
      phone: legacy.phone.trim(),
      legacyNickname: legacy.name.trim(),
      legacyBirthday: legacyBirthday?.text ?? null,
      legacyTier: legacy.status === 'vip' ? 'advanced' : 'ordinary',
      legacyBalanceFen: yuanToFen(legacy.balance, '旧会员余额'),
      legacyMonthlyCardStatus: monthlyStatus,
      currentMemberId: current.id,
      currentNickname: current.nickname,
      currentBirthday,
      currentTier: current.current_tier,
      currentBalanceFen:
        current.principal_balance_fen + current.gift_balance_fen,
      currentMonthlyCardStatus: current.monthly_card_status,
      conflicts
    })
  }

  const catalogConflicts: LegacyCatalogImportConflict[] = []
  for (const legacy of rows.catalogItems) {
    const current = target
      .prepare(
        `SELECT id, name, regular_price_fen, advanced_price_fen
         FROM catalog_item
         WHERE tenant_id = ? AND store_id = ? AND trim(name) = trim(?)
         ORDER BY created_at LIMIT 1`
      )
      .get(context.tenantId, context.storeId, legacy.name.trim()) as
      | {
          id: string
          name: string
          regular_price_fen: number
          advanced_price_fen: number
        }
      | undefined
    if (!current) continue
    const regularPriceFen = yuanToFen(legacy.priceRegular, '旧收费项目普通价')
    const advancedPriceFen = yuanToFen(legacy.priceVip, '旧收费项目高级会员价')
    if (
      current.regular_price_fen === regularPriceFen &&
      current.advanced_price_fen === advancedPriceFen
    ) {
      continue
    }
    catalogConflicts.push({
      legacyId: legacy.id,
      legacyName: legacy.name.trim(),
      legacyRegularPriceFen: regularPriceFen,
      legacyAdvancedPriceFen: advancedPriceFen,
      currentItemId: current.id,
      currentName: current.name,
      currentRegularPriceFen: current.regular_price_fen,
      currentAdvancedPriceFen: current.advanced_price_fen
    })
  }

  const storedBalanceFen = rows.members.reduce(
    (sum, member) => sum + yuanToFen(member.balance, '旧会员余额'),
    0
  )
  const alreadyImported = Boolean(
    target
      .prepare(
        `SELECT id FROM legacy_import_batch
         WHERE tenant_id = ?
         LIMIT 1`
      )
      .get(context.tenantId)
  )
  const summary: LegacyImportSummary = {
    members: rows.members.length,
    transactions: rows.transactions.length,
    activityLogs: rows.activityLogs.length,
    quickDeductItems: rows.catalogItems.length,
    storedBalanceFen,
    activeMonthlyCards,
    expiredMonthlyCards,
    newMembers: rows.members.length - matchedMembers,
    matchedMembers,
    memberConflicts: memberConflicts.length,
    catalogConflicts: catalogConflicts.length,
    reconciliationIssues: reconciliation.size
  }
  const warnings: string[] = []
  if (alreadyImported) {
    warnings.push(
      '当前业务数据库已经完成过一次旧库导入。若要改用更新快照，请恢复导入前备份或在新的测试数据库中重新执行，避免重复余额。'
    )
  }
  if (reconciliation.size > 0) {
    warnings.push(
      `${reconciliation.size} 名会员的旧交易重算结果与会员表余额不同；导入时以会员表余额作为可用期初余额，并保留差额核对项。`
    )
  }
  if (activeMonthlyCards > 0) {
    warnings.push(
      '有效旧月卡会按原开始和结束时间启用；因旧库没有支付渠道，程序内禁止自动退款。'
    )
  }
  return {
    ...metadata,
    alreadyImported,
    summary,
    memberConflicts,
    catalogConflicts,
    warnings,
    assumptions: [
      '旧库不带时区的时间按中国标准时间（Asia/Shanghai）解释。',
      '旧库余额无法拆分本金与赠送，统一导入为有来源标记的期初本金。',
      '旧交易和活动日志只作为不可变历史导入，不会再次改变当前余额。',
      '旧月卡没有可信支付渠道和售价；保留原始字段，有效卡按当前默认月卡价格展示且不可自动退款。'
    ]
  }
}

function nextMemberNumber(id: string): string {
  return `M${id.replaceAll('-', '').slice(0, 10).toUpperCase()}`
}

function nextCatalogCode(id: string): string {
  return `C${id.replaceAll('-', '').slice(0, 10).toUpperCase()}`
}

function checksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function insertRawRows(
  target: DatabaseSync,
  tenantId: string,
  batchId: string,
  table: string,
  rows: Array<Record<string, unknown>>
): void {
  const insert = target.prepare(
    `INSERT INTO legacy_raw_row
     (id, tenant_id, import_batch_id, legacy_table, legacy_id, row_json, checksum)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const row of rows) {
    const rowJson = JSON.stringify(row)
    insert.run(
      randomUUID(),
      tenantId,
      batchId,
      table,
      String(row.id),
      rowJson,
      createHash('sha256').update(rowJson).digest('hex')
    )
  }
}

function createOpeningBalance(
  target: DatabaseSync,
  context: LegacyImportContext,
  input: {
    batchId: string
    legacyMemberId: string
    memberId: string
    amountFen: number
    timestamp: string
  }
): void {
  if (input.amountFen <= 0) return
  let wallet = target
    .prepare(
      `SELECT id, principal_balance_fen, gift_balance_fen
       FROM wallet_account WHERE tenant_id = ? AND member_id = ?`
    )
    .get(context.tenantId, input.memberId) as
    | {
        id: string
        principal_balance_fen: number
        gift_balance_fen: number
      }
    | undefined
  if (!wallet) {
    wallet = {
      id: randomUUID(),
      principal_balance_fen: 0,
      gift_balance_fen: 0
    }
    target
      .prepare(
        `INSERT INTO wallet_account
         (id, tenant_id, store_id, member_id, status, principal_balance_fen,
          gift_balance_fen, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 0, 0, ?, ?)`
      )
      .run(
        wallet.id,
        context.tenantId,
        context.storeId,
        input.memberId,
        input.timestamp,
        input.timestamp
      )
  }
  const sourceId = `legacy:${input.batchId}:${input.legacyMemberId}`
  const principalAfter = wallet.principal_balance_fen + input.amountFen
  if (!Number.isSafeInteger(principalAfter)) {
    throw new Error('旧库余额超过程序支持范围')
  }
  target
    .prepare(
      `INSERT INTO wallet_lot
       (id, tenant_id, store_id, wallet_account_id, member_id, source_type,
        source_id, original_principal_fen, original_gift_fen,
        remaining_principal_fen, remaining_gift_fen, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'legacy', ?, ?, 0, ?, 0, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      wallet.id,
      input.memberId,
      sourceId,
      input.amountFen,
      input.amountFen,
      input.timestamp,
      input.timestamp
    )
  target
    .prepare(
      `INSERT INTO wallet_ledger
       (id, tenant_id, store_id, wallet_account_id, member_id, entry_type,
        principal_delta_fen, gift_delta_fen, principal_balance_after_fen,
        gift_balance_after_fen, source_id, related_ledger_id, request_id,
        actor_id, device_id, reason, metadata_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, 'legacy_opening', ?, 0, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      wallet.id,
      input.memberId,
      input.amountFen,
      principalAfter,
      wallet.gift_balance_fen,
      sourceId,
      `${sourceId}:opening`,
      context.actor.id,
      context.deviceId,
      '旧数据库期初余额导入',
      JSON.stringify({
        importBatchId: input.batchId,
        legacyMemberId: input.legacyMemberId
      }),
      input.timestamp
    )
  target
    .prepare(
      `UPDATE wallet_account
       SET principal_balance_fen = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(principalAfter, input.timestamp, wallet.id)
}

function ensureLegacyVipGrant(
  target: DatabaseSync,
  context: LegacyImportContext,
  input: {
    batchId: string
    legacyMemberId: string
    memberId: string
    timestamp: string
  }
): void {
  target
    .prepare(
      `INSERT INTO membership_grant
       (id, tenant_id, store_id, member_id, source_type, source_id, granted_tier,
        reason, granted_by, granted_at)
       VALUES (?, ?, ?, ?, 'legacy', ?, 'advanced', ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      input.memberId,
      `legacy:${input.batchId}:${input.legacyMemberId}:vip`,
      '旧数据库高级会员身份',
      context.actor.id,
      input.timestamp
    )
}

function ensureMonthlyPlan(
  target: DatabaseSync,
  context: StoreContext,
  timestamp: string
): {
  id: string
  name: string
  priceFen: number
  durationDays: number
} {
  const existing = target
    .prepare(
      `SELECT id, name, price_fen, duration_days
       FROM monthly_card_plan
       WHERE tenant_id = ? AND store_id = ? AND active = 1
       ORDER BY created_at LIMIT 1`
    )
    .get(context.tenantId, context.storeId) as
    | {
        id: string
        name: string
        price_fen: number
        duration_days: number
      }
    | undefined
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      priceFen: existing.price_fen,
      durationDays: existing.duration_days
    }
  }
  const id = randomUUID()
  target
    .prepare(
      `INSERT INTO monthly_card_plan
       (id, tenant_id, store_id, name, price_fen, duration_days, active,
        created_at, updated_at)
       VALUES (?, ?, ?, '30 天月卡', 20000, 30, 1, ?, ?)`
    )
    .run(id, context.tenantId, context.storeId, timestamp, timestamp)
  return { id, name: '30 天月卡', priceFen: 20_000, durationDays: 30 }
}

function importMonthlyCard(
  target: DatabaseSync,
  context: LegacyImportContext,
  input: {
    batchId: string
    memberId: string
    legacy: LegacyMemberRow
    choice: 'keep_current' | 'use_legacy'
    timestamp: string
    now: Date
  }
): boolean {
  const monthlyStatus = legacyMonthlyStatus(input.legacy, input.now)
  if (!monthlyStatus) return false
  const startsAt = normalizeLegacyTimestamp(
    input.legacy.subscription_start_date,
    '月卡开始时间'
  )
  const expiresAt = normalizeLegacyTimestamp(
    input.legacy.subscription_end_date,
    '月卡结束时间',
    true
  )
  let operationalCardId: string | null = null
  const current = target
    .prepare(
      `SELECT id FROM monthly_card
       WHERE tenant_id = ? AND member_id = ? AND status IN ('active', 'paused')
       ORDER BY purchased_at DESC LIMIT 1`
    )
    .get(context.tenantId, input.memberId) as { id: string } | undefined

  if (monthlyStatus === 'active' && (!current || input.choice === 'use_legacy')) {
    if (current) {
      target
        .prepare(
          `UPDATE monthly_card
           SET status = 'expired', updated_at = ?
           WHERE id = ?`
        )
        .run(input.timestamp, current.id)
      target
        .prepare(
          `INSERT INTO monthly_card_event
           (id, tenant_id, store_id, card_id, member_id, event_type, request_id,
            actor_id, device_id, reason, metadata_json, occurred_at)
           VALUES (?, ?, ?, ?, ?, 'expired', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          randomUUID(),
          context.tenantId,
          context.storeId,
          current.id,
          input.memberId,
          `legacy-replace:${input.batchId}:${current.id}`,
          context.actor.id,
          context.deviceId,
          '店长选择使用旧库有效月卡',
          JSON.stringify({ importBatchId: input.batchId }),
          input.timestamp
        )
    }
    const plan = ensureMonthlyPlan(target, context, input.timestamp)
    operationalCardId = randomUUID()
    target
      .prepare(
        `INSERT INTO monthly_card
         (id, tenant_id, store_id, member_id, plan_id, plan_name_snapshot,
          price_fen, duration_days, payment_method, status, request_id,
          purchased_by, purchased_at, starts_at, expires_at, paused_at,
          total_paused_seconds, updated_at, source, legacy_import_batch_id,
          legacy_member_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cash', 'active', ?, ?, ?, ?, ?, NULL,
                 0, ?, 'legacy', ?, ?)`
      )
      .run(
        operationalCardId,
        context.tenantId,
        context.storeId,
        input.memberId,
        plan.id,
        input.legacy.subscription_plan_name?.trim() || plan.name,
        plan.priceFen,
        plan.durationDays,
        `legacy:${input.batchId}:${input.legacy.id}:monthly-card`,
        context.actor.id,
        startsAt,
        startsAt,
        expiresAt,
        input.timestamp,
        input.batchId,
        input.legacy.id
      )
    target
      .prepare(
        `INSERT INTO monthly_card_event
         (id, tenant_id, store_id, card_id, member_id, event_type, request_id,
          actor_id, device_id, reason, metadata_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, 'purchased', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        context.tenantId,
        context.storeId,
        operationalCardId,
        input.memberId,
        `legacy:${input.batchId}:${input.legacy.id}:monthly-event`,
        context.actor.id,
        context.deviceId,
        '旧数据库有效月卡导入',
        JSON.stringify({
          paymentMethodKnown: false,
          importBatchId: input.batchId
        }),
        startsAt
      )
  }

  const historyId = randomUUID()
  target
    .prepare(
      `INSERT INTO legacy_monthly_card_history
       (id, tenant_id, store_id, import_batch_id, member_id, legacy_member_id,
        plan_name, starts_at_raw, expires_at_raw, starts_at_normalized,
        expires_at_normalized, imported_status, operational_card_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      historyId,
      context.tenantId,
      context.storeId,
      input.batchId,
      input.memberId,
      input.legacy.id,
      input.legacy.subscription_plan_name?.trim() || '旧库月卡',
      input.legacy.subscription_start_date,
      input.legacy.subscription_end_date,
      startsAt,
      expiresAt,
      monthlyStatus,
      operationalCardId
    )
  target
    .prepare(
      `INSERT INTO legacy_id_mapping
       (id, tenant_id, entity_type, entity_id, legacy_source, legacy_table,
        legacy_id, import_batch_id, imported_at, checksum)
       VALUES (?, ?, 'legacy_monthly_card_history', ?, 'members.db',
               'member_subscriptions', ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      historyId,
      input.legacy.id,
      input.batchId,
      input.timestamp,
      checksum({
        planName: input.legacy.subscription_plan_name,
        startsAt: input.legacy.subscription_start_date,
        expiresAt: input.legacy.subscription_end_date
      })
    )
  return true
}

function appendBatchAuditAndOutbox(
  target: DatabaseSync,
  context: LegacyImportContext,
  batchId: string,
  summary: unknown,
  timestamp: string
): void {
  const sequence = target
    .prepare('SELECT next_sequence FROM device WHERE id = ?')
    .get(context.deviceId) as { next_sequence: number } | undefined
  if (!sequence) throw new Error('收银设备记录缺失')
  target
    .prepare(
      `UPDATE device SET next_sequence = next_sequence + 1, updated_at = ?
       WHERE id = ?`
    )
    .run(timestamp, context.deviceId)
  const payload = JSON.stringify({ batchId, summary })
  target
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, 'legacy.import.completed', 'legacy_import', ?,
               '店长确认旧数据库合并', NULL, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      context.actor.id,
      batchId,
      payload,
      timestamp
    )
  target
    .prepare(
      `INSERT INTO outbox_operation
       (operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
        operation_type, aggregate_id, base_version, occurred_at, payload_json,
        payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, 'legacy.import.completed', ?, NULL, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      context.deviceId,
      sequence.next_sequence,
      context.tenantId,
      context.storeId,
      context.actor.id,
      batchId,
      timestamp,
      payload,
      createHash('sha256').update(payload).digest('hex')
    )
}

type LegacyCloudOutboxAccumulator = {
  nextSequence: number
  created: number
  byType: Record<string, number>
}

function appendLegacyCloudOutbox(
  target: DatabaseSync,
  context: StoreContext,
  actorId: string,
  timestamp: string,
  accumulator: LegacyCloudOutboxAccumulator,
  operationType: string,
  aggregateId: string,
  payloadValue: unknown
): void {
  const payload = JSON.stringify(payloadValue)
  target
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
      accumulator.nextSequence,
      context.tenantId,
      context.storeId,
      actorId,
      operationType,
      aggregateId,
      timestamp,
      payload,
      createHash('sha256').update(payload).digest('hex')
    )
  accumulator.nextSequence += 1
  accumulator.created += 1
  accumulator.byType[operationType] =
    (accumulator.byType[operationType] ?? 0) + 1
}

function monthlyCardSnapshot(
  card: Record<string, unknown>,
  status = String(card.status)
): Record<string, unknown> {
  return {
    id: String(card.id),
    memberId: String(card.member_id),
    planName: String(card.plan_name_snapshot),
    priceFen: Number(card.price_fen),
    paymentMethod: card.payment_method === 'wechat' ? 'wechat' : 'cash',
    status,
    purchasedAt: String(card.purchased_at),
    startsAt: String(card.starts_at),
    expiresAt: String(card.expires_at),
    pausedAt: card.paused_at === null ? null : String(card.paused_at),
    usageCount: Number(card.usage_count),
    scopeType: card.scope_type === 'tenant' ? 'tenant' : 'store',
    issuingStoreId: String(card.store_id)
  }
}

function prepareLegacyImportCloudSyncInOpenTransaction(
  target: DatabaseSync,
  context: StoreContext,
  batch: {
    id: string
    imported_by: string
    imported_at: string
  },
  now: Date
): LegacyImportCloudSyncResult {
  const alreadyPrepared = target
    .prepare(
      `SELECT 1 FROM audit_log
       WHERE tenant_id = ? AND store_id = ?
         AND action = 'legacy.import.cloud_sync_prepared'
         AND aggregate_type = 'legacy_import' AND aggregate_id = ?
       LIMIT 1`
    )
    .get(context.tenantId, context.storeId, batch.id)
  if (alreadyPrepared) return { batches: 0, created: 0, byType: {} }

  const sequence = target
    .prepare('SELECT next_sequence FROM device WHERE id = ?')
    .get(context.deviceId) as { next_sequence: number } | undefined
  if (!sequence) throw new Error('收银设备记录缺失')
  const timestamp = now.toISOString()
  const accumulator: LegacyCloudOutboxAccumulator = {
    nextSequence: sequence.next_sequence,
    created: 0,
    byType: {}
  }

  const members = target
    .prepare(
      `SELECT m.id, m.member_number, m.phone, m.nickname, m.status,
              m.birthday_month, m.birthday_day, m.birthday_source, m.note,
              m.source, m.age_gate_status, m.created_at, m.updated_at,
              COUNT(CASE WHEN g.id IS NOT NULL AND g.revoked_at IS NULL
                         THEN 1 END) advanced_grants
       FROM legacy_id_mapping mapping
       JOIN member m ON m.id = mapping.entity_id AND m.tenant_id = mapping.tenant_id
       LEFT JOIN membership_grant g
         ON g.tenant_id = m.tenant_id AND g.member_id = m.id
       WHERE mapping.tenant_id = ? AND mapping.import_batch_id = ?
         AND mapping.entity_type = 'member'
       GROUP BY m.id
       ORDER BY m.created_at, m.id`
    )
    .all(context.tenantId, batch.id) as Array<Record<string, unknown>>
  for (const member of members) {
    const id = String(member.id)
    const after = {
      id,
      memberNumber: String(member.member_number),
      phone: String(member.phone),
      nickname: String(member.nickname),
      tier: Number(member.advanced_grants) > 0 ? 'advanced' : 'ordinary',
      status: member.status === 'active' ? 'active' : 'disabled',
      birthdayMonth:
        member.birthday_month === null ? null : Number(member.birthday_month),
      birthdayDay:
        member.birthday_day === null ? null : Number(member.birthday_day),
      birthdaySource:
        member.birthday_source === null ? null : String(member.birthday_source),
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
    appendLegacyCloudOutbox(
      target,
      context,
      batch.imported_by,
      timestamp,
      accumulator,
      'member.snapshot',
      id,
      {
        action: 'member.snapshot',
        memberId: id,
        before: null,
        after,
        reason: '旧数据库导入会员云端投影',
        legacyImportBatchId: batch.id
      }
    )
  }

  const catalogItems = target
    .prepare(
      `SELECT DISTINCT item.id, item.code, item.name, item.item_type,
              item.regular_price_fen, item.advanced_price_fen, item.status,
              item.availability, item.note, item.created_at, item.updated_at
       FROM legacy_id_mapping mapping
       JOIN catalog_item item
         ON item.id = mapping.entity_id AND item.tenant_id = mapping.tenant_id
       WHERE mapping.tenant_id = ? AND mapping.import_batch_id = ?
         AND mapping.entity_type = 'catalog_item'
       ORDER BY item.created_at, item.id`
    )
    .all(context.tenantId, batch.id) as Array<Record<string, unknown>>
  for (const item of catalogItems) {
    const id = String(item.id)
    appendLegacyCloudOutbox(
      target,
      context,
      batch.imported_by,
      timestamp,
      accumulator,
      'catalog.snapshot',
      id,
      {
        action: 'catalog.snapshot',
        itemId: id,
        before: null,
        after: {
          id,
          code: String(item.code),
          name: String(item.name),
          itemType: String(item.item_type),
          regularPriceFen: Number(item.regular_price_fen),
          advancedPriceFen: Number(item.advanced_price_fen),
          status: String(item.status),
          availability: String(item.availability),
          note: item.note === null ? null : String(item.note),
          createdAt: String(item.created_at),
          updatedAt: String(item.updated_at)
        },
        reason: '旧数据库导入收费项目云端投影',
        legacyImportBatchId: batch.id
      }
    )
  }

  const openingBalances = target
    .prepare(
      `SELECT ledger.id, ledger.wallet_account_id, ledger.member_id,
              ledger.principal_delta_fen, ledger.gift_delta_fen,
              ledger.source_id, ledger.occurred_at,
              wallet.status, wallet.principal_balance_fen,
              wallet.gift_balance_fen, wallet.updated_at
       FROM wallet_ledger ledger
       JOIN wallet_account wallet ON wallet.id = ledger.wallet_account_id
       WHERE ledger.tenant_id = ? AND ledger.entry_type = 'legacy_opening'
         AND json_extract(ledger.metadata_json, '$.importBatchId') = ?
       ORDER BY ledger.occurred_at, ledger.id`
    )
    .all(context.tenantId, batch.id) as Array<Record<string, unknown>>
  for (const opening of openingBalances) {
    const walletId = String(opening.wallet_account_id)
    const principalBalanceFen = Number(opening.principal_balance_fen)
    const giftBalanceFen = Number(opening.gift_balance_fen)
    appendLegacyCloudOutbox(
      target,
      context,
      batch.imported_by,
      timestamp,
      accumulator,
      'wallet.snapshot',
      walletId,
      {
        action: 'wallet.snapshot',
        aggregateId: walletId,
        before: null,
        after: {
          operationId: String(opening.source_id),
          wallet: {
            accountId: walletId,
            memberId: String(opening.member_id),
            principalBalanceFen,
            giftBalanceFen,
            totalBalanceFen: principalBalanceFen + giftBalanceFen,
            status: opening.status === 'frozen' ? 'frozen' : 'active',
            updatedAt: String(opening.updated_at)
          },
          principalDeltaFen: Number(opening.principal_delta_fen),
          giftDeltaFen: Number(opening.gift_delta_fen)
        },
        reason: '旧数据库期初余额导入',
        legacyImportBatchId: batch.id,
        legacyLedgerId: String(opening.id)
      }
    )
  }

  const cardSelect = `
    SELECT card.id, card.store_id, card.member_id, card.plan_name_snapshot,
           card.price_fen, card.payment_method, card.status, card.purchased_at,
           card.starts_at, card.expires_at, card.paused_at, card.scope_type,
           (SELECT COUNT(*) FROM monthly_card_event usage_event
            WHERE usage_event.tenant_id = card.tenant_id
              AND usage_event.card_id = card.id
              AND usage_event.event_type = 'used') usage_count
    FROM monthly_card card`
  const replacedCards = target
    .prepare(
      `${cardSelect}
       JOIN monthly_card_event replacement
         ON replacement.card_id = card.id
        AND replacement.tenant_id = card.tenant_id
        AND replacement.event_type = 'expired'
       WHERE card.tenant_id = ?
         AND json_extract(replacement.metadata_json, '$.importBatchId') = ?
       ORDER BY replacement.occurred_at, card.id`
    )
    .all(context.tenantId, batch.id) as Array<Record<string, unknown>>
  for (const card of replacedCards) {
    const id = String(card.id)
    const beforeStatus = card.paused_at === null ? 'active' : 'paused'
    appendLegacyCloudOutbox(
      target,
      context,
      batch.imported_by,
      timestamp,
      accumulator,
      'monthly_card.expired',
      id,
      {
        action: 'monthly_card.expired',
        cardId: id,
        before: monthlyCardSnapshot(card, beforeStatus),
        after: monthlyCardSnapshot(card, 'expired'),
        reason: '店长选择使用旧库有效月卡',
        legacyImportBatchId: batch.id
      }
    )
  }

  const importedCards = target
    .prepare(
      `${cardSelect}
       WHERE card.tenant_id = ? AND card.legacy_import_batch_id = ?
       ORDER BY card.purchased_at, card.id`
    )
    .all(context.tenantId, batch.id) as Array<Record<string, unknown>>
  for (const card of importedCards) {
    const id = String(card.id)
    const status =
      card.status === 'active' &&
      new Date(String(card.expires_at)).getTime() <= now.getTime()
        ? 'expired'
        : String(card.status)
    appendLegacyCloudOutbox(
      target,
      context,
      batch.imported_by,
      timestamp,
      accumulator,
      'monthly_card.snapshot',
      id,
      {
        action: 'monthly_card.snapshot',
        cardId: id,
        before: null,
        after: monthlyCardSnapshot(card, status),
        reason: '旧数据库有效月卡云端投影',
        legacyImportBatchId: batch.id
      }
    )
  }

  target
    .prepare(
      `UPDATE device SET next_sequence = ?, updated_at = ? WHERE id = ?`
    )
    .run(accumulator.nextSequence, timestamp, context.deviceId)
  target
    .prepare(
      `INSERT INTO audit_log
       (id, tenant_id, store_id, device_id, actor_id, action, aggregate_type,
        aggregate_id, reason, before_json, after_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, 'legacy.import.cloud_sync_prepared',
               'legacy_import', ?, '旧库核对结果已生成云端幂等同步操作',
               NULL, ?, ?)`
    )
    .run(
      randomUUID(),
      context.tenantId,
      context.storeId,
      context.deviceId,
      batch.imported_by,
      batch.id,
      JSON.stringify({ created: accumulator.created, byType: accumulator.byType }),
      timestamp
    )
  return {
    batches: 1,
    created: accumulator.created,
    byType: accumulator.byType
  }
}

export function ensureLegacyImportCloudSyncOutbox(
  target: DatabaseSync,
  context: StoreContext,
  now = new Date()
): LegacyImportCloudSyncResult {
  const batches = target
    .prepare(
      `SELECT batch.id, batch.imported_by, batch.imported_at
       FROM legacy_import_batch batch
       WHERE batch.tenant_id = ? AND batch.store_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM audit_log audit
           WHERE audit.tenant_id = batch.tenant_id
             AND audit.store_id = batch.store_id
             AND audit.action = 'legacy.import.cloud_sync_prepared'
             AND audit.aggregate_type = 'legacy_import'
             AND audit.aggregate_id = batch.id
         )
       ORDER BY batch.imported_at, batch.id`
    )
    .all(context.tenantId, context.storeId) as Array<{
      id: string
      imported_by: string
      imported_at: string
    }>
  const result: LegacyImportCloudSyncResult = {
    batches: 0,
    created: 0,
    byType: {}
  }
  if (batches.length === 0) return result
  target.exec('BEGIN IMMEDIATE')
  try {
    for (const batch of batches) {
      const prepared = prepareLegacyImportCloudSyncInOpenTransaction(
        target,
        context,
        batch,
        now
      )
      result.batches += prepared.batches
      result.created += prepared.created
      for (const [type, count] of Object.entries(prepared.byType)) {
        result.byType[type] = (result.byType[type] ?? 0) + count
      }
    }
    target.exec('COMMIT')
    return result
  } catch (error) {
    target.exec('ROLLBACK')
    throw error
  }
}

export function importLegacyDatabase(
  source: DatabaseSync,
  target: DatabaseSync,
  context: LegacyImportContext,
  metadata: LegacySourceMetadata,
  input: {
    memberResolutions: LegacyMemberImportResolution[]
    catalogResolutions: LegacyCatalogImportResolution[]
    now?: Date
    prepareCloudSync?: boolean
  }
): Omit<LegacyImportResult, 'backupPath'> {
  const now = input.now ?? new Date()
  const inspection = inspectLegacyDatabase(source, target, context, metadata, now)
  if (inspection.alreadyImported) {
    throw new Error('当前业务数据库已经完成过旧库导入，不能再次增加旧余额')
  }
  const memberResolutions = new Map(
    input.memberResolutions.map((resolution) => [
      resolution.legacyId,
      resolution
    ])
  )
  const catalogResolutions = new Map(
    input.catalogResolutions.map((resolution) => [
      resolution.legacyId,
      resolution
    ])
  )
  for (const conflict of inspection.memberConflicts) {
    if (!memberResolutions.has(conflict.legacyId)) {
      throw new Error(`会员 ${conflict.phone} 的冲突尚未选择处理方式`)
    }
  }
  for (const conflict of inspection.catalogConflicts) {
    if (!catalogResolutions.has(conflict.legacyId)) {
      throw new Error(`收费项目 ${conflict.legacyName} 的冲突尚未选择处理方式`)
    }
  }

  const rows = readLegacyRows(source)
  const batchId = randomUUID()
  const timestamp = now.toISOString()
  const currentMembers = currentMemberByPhone(target, context.tenantId)
  const reconciliation = calculateReconciliationIssues(rows)
  const memberIds = new Map<string, string>()
  let importedMembers = 0
  let mergedMembers = 0
  let openingBalanceFen = 0
  let importedMonthlyCards = 0
  let importedCatalogItems = 0

  target.exec('BEGIN IMMEDIATE')
  try {
    target
      .prepare(
        `INSERT INTO legacy_import_batch
         (id, tenant_id, store_id, source_name, source_sha256, source_size_bytes,
          imported_by, imported_at, summary_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        batchId,
        context.tenantId,
        context.storeId,
        metadata.sourceName,
        metadata.sourceSha256,
        metadata.sourceSizeBytes,
        context.actor.id,
        timestamp,
        JSON.stringify(inspection.summary)
      )
    insertRawRows(
      target,
      context.tenantId,
      batchId,
      'members',
      rows.members as unknown as Array<Record<string, unknown>>
    )
    insertRawRows(
      target,
      context.tenantId,
      batchId,
      'transactions',
      rows.transactions as unknown as Array<Record<string, unknown>>
    )
    insertRawRows(
      target,
      context.tenantId,
      batchId,
      'activity_logs',
      rows.activityLogs as unknown as Array<Record<string, unknown>>
    )
    insertRawRows(
      target,
      context.tenantId,
      batchId,
      'quick_deduct_items',
      rows.catalogItems as unknown as Array<Record<string, unknown>>
    )

    for (const legacy of rows.members) {
      const existing = currentMembers.get(legacy.phone.trim())
      const resolution = memberResolutions.get(legacy.id)
      const birthday = parseBirthday(legacy.birthday)
      const createdAt = legacy.created_at?.trim()
        ? normalizeLegacyTimestamp(legacy.created_at, '会员创建时间')
        : legacy.joinDate?.trim()
          ? normalizeLegacyTimestamp(legacy.joinDate, '会员加入时间')
          : timestamp
      let memberId: string
      if (!existing) {
        memberId = randomUUID()
        target
          .prepare(
            `INSERT INTO member
             (id, tenant_id, store_id, member_number, phone, nickname, status,
              birthday_month, birthday_day, birthday_source, birthday_locked,
              confirmed_at_least_14, note, source, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 1, NULL, 'legacy', ?, ?)`
          )
          .run(
            memberId,
            context.tenantId,
            context.storeId,
            nextMemberNumber(memberId),
            legacy.phone.trim(),
            legacy.name.trim(),
            birthday?.month ?? null,
            birthday?.day ?? null,
            birthday ? 'legacy' : null,
            birthday ? 1 : 0,
            createdAt,
            timestamp
          )
        importedMembers += 1
      } else {
        memberId = existing.id
        const nickname =
          resolution?.nickname === 'use_legacy'
            ? legacy.name.trim()
            : existing.nickname
        const useLegacyBirthday =
          birthday &&
          (existing.birthday_month === null ||
            resolution?.birthday === 'use_legacy')
        target
          .prepare(
            `UPDATE member
             SET nickname = ?,
                 birthday_month = CASE WHEN ? THEN ? ELSE birthday_month END,
                 birthday_day = CASE WHEN ? THEN ? ELSE birthday_day END,
                 birthday_source = CASE WHEN ? THEN 'legacy' ELSE birthday_source END,
                 birthday_locked = CASE WHEN ? THEN 1 ELSE birthday_locked END,
                 updated_at = ?
             WHERE tenant_id = ? AND id = ?`
          )
          .run(
            nickname,
            useLegacyBirthday ? 1 : 0,
            birthday?.month ?? null,
            useLegacyBirthday ? 1 : 0,
            birthday?.day ?? null,
            useLegacyBirthday ? 1 : 0,
            useLegacyBirthday ? 1 : 0,
            timestamp,
            context.tenantId,
            memberId
          )
        mergedMembers += 1
      }
      memberIds.set(legacy.id, memberId)
      target
        .prepare(
          `INSERT INTO legacy_id_mapping
           (id, tenant_id, entity_type, entity_id, legacy_source, legacy_table,
            legacy_id, import_batch_id, imported_at, checksum)
           VALUES (?, ?, 'member', ?, 'members.db', 'members', ?, ?, ?, ?)`
        )
        .run(
          randomUUID(),
          context.tenantId,
          memberId,
          legacy.id,
          batchId,
          timestamp,
          checksum(legacy)
        )
      if (legacy.status === 'vip') {
        ensureLegacyVipGrant(target, context, {
          batchId,
          legacyMemberId: legacy.id,
          memberId,
          timestamp
        })
      }
      const balanceFen = yuanToFen(legacy.balance, '旧会员余额')
      const shouldAddBalance =
        !existing || resolution?.balance === 'add_legacy'
      if (shouldAddBalance) {
        createOpeningBalance(target, context, {
          batchId,
          legacyMemberId: legacy.id,
          memberId,
          amountFen: balanceFen,
          timestamp
        })
        openingBalanceFen += balanceFen
      }
      if (
        importMonthlyCard(target, context, {
          batchId,
          memberId,
          legacy,
          choice: resolution?.monthlyCard ?? 'keep_current',
          timestamp,
          now
        })
      ) {
        importedMonthlyCards += 1
      }
      target
        .prepare(
          `INSERT INTO legacy_import_resolution
           (id, tenant_id, import_batch_id, conflict_type, legacy_id,
            resolution_json)
           VALUES (?, ?, ?, 'member', ?, ?)`
        )
        .run(
          randomUUID(),
          context.tenantId,
          batchId,
          legacy.id,
          JSON.stringify(
            resolution ?? {
              nickname: 'keep_current',
              birthday: 'keep_current',
              balance: existing ? 'keep_current' : 'add_legacy',
              monthlyCard: 'keep_current'
            }
          )
        )
      const difference = reconciliation.get(legacy.id)
      if (difference !== undefined) {
        const transactionBalance = balanceFen - difference
        target
          .prepare(
            `INSERT INTO legacy_reconciliation_issue
             (id, tenant_id, store_id, import_batch_id, member_id,
              legacy_member_id, issue_type, expected_fen, actual_fen, detail)
             VALUES (?, ?, ?, ?, ?, ?, 'wallet_balance_mismatch', ?, ?, ?)`
          )
          .run(
            randomUUID(),
            context.tenantId,
            context.storeId,
            batchId,
            memberId,
            legacy.id,
            balanceFen,
            transactionBalance,
            '会员表余额与旧交易充值减扣款重算结果不同；以会员表余额作为期初余额'
          )
      }
    }

    const insertHistory = target.prepare(
      `INSERT INTO legacy_financial_history
       (id, tenant_id, store_id, import_batch_id, member_id, legacy_table,
        legacy_id, legacy_member_id, event_type, amount_fen, description,
        occurred_at_raw, occurred_at_normalized)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const transaction of rows.transactions) {
      const occurredAtRaw = transaction.date ?? transaction.created_at
      const historyId = randomUUID()
      insertHistory.run(
        historyId,
        context.tenantId,
        context.storeId,
        batchId,
        memberIds.get(transaction.member_id) ?? null,
        'transactions',
        transaction.id,
        transaction.member_id,
        transaction.type,
        yuanToFen(transaction.amount, '旧交易金额'),
        transaction.notes,
        occurredAtRaw,
        normalizeOptionalTimestamp(occurredAtRaw)
      )
      target
        .prepare(
          `INSERT INTO legacy_id_mapping
           (id, tenant_id, entity_type, entity_id, legacy_source, legacy_table,
            legacy_id, import_batch_id, imported_at, checksum)
           VALUES (?, ?, 'legacy_financial_history', ?, 'members.db',
                   'transactions', ?, ?, ?, ?)`
        )
        .run(
          randomUUID(),
          context.tenantId,
          historyId,
          transaction.id,
          batchId,
          timestamp,
          checksum(transaction)
        )
    }
    for (const activity of rows.activityLogs) {
      const historyId = randomUUID()
      insertHistory.run(
        historyId,
        context.tenantId,
        context.storeId,
        batchId,
        activity.member_id ? (memberIds.get(activity.member_id) ?? null) : null,
        'activity_logs',
        activity.id,
        activity.member_id,
        activity.action_type,
        activity.amount === null
          ? null
          : yuanToFen(activity.amount, '旧活动日志金额'),
        activity.description,
        activity.created_at,
        normalizeOptionalTimestamp(activity.created_at)
      )
      target
        .prepare(
          `INSERT INTO legacy_id_mapping
           (id, tenant_id, entity_type, entity_id, legacy_source, legacy_table,
            legacy_id, import_batch_id, imported_at, checksum)
           VALUES (?, ?, 'legacy_financial_history', ?, 'members.db',
                   'activity_logs', ?, ?, ?, ?)`
        )
        .run(
          randomUUID(),
          context.tenantId,
          historyId,
          activity.id,
          batchId,
          timestamp,
          checksum(activity)
        )
    }

    for (const legacy of rows.catalogItems) {
      const current = target
        .prepare(
          `SELECT id, regular_price_fen, advanced_price_fen
           FROM catalog_item
           WHERE tenant_id = ? AND store_id = ? AND trim(name) = trim(?)
           ORDER BY created_at LIMIT 1`
        )
        .get(context.tenantId, context.storeId, legacy.name.trim()) as
        | {
            id: string
            regular_price_fen: number
            advanced_price_fen: number
          }
        | undefined
      const regularPriceFen = yuanToFen(legacy.priceRegular, '旧收费项目普通价')
      const advancedPriceFen = yuanToFen(legacy.priceVip, '旧收费项目高级会员价')
      const resolution = catalogResolutions.get(legacy.id)
      let catalogId: string
      const pricesMatch =
        current?.regular_price_fen === regularPriceFen &&
        current?.advanced_price_fen === advancedPriceFen
      if (current && (pricesMatch || resolution?.choice === 'keep_current')) {
        catalogId = current.id
      } else {
        catalogId = randomUUID()
        const name =
          current && resolution?.choice === 'import_as_new'
            ? `${legacy.name.trim()}（旧库）`
            : legacy.name.trim()
        target
          .prepare(
            `INSERT INTO catalog_item
             (id, tenant_id, store_id, code, name, item_type,
              regular_price_fen, advanced_price_fen, status, availability,
              note, source, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'service', ?, ?, 'active', 'available',
                     '从旧收银系统快捷扣款项目导入', 'legacy', ?, ?)`
          )
          .run(
            catalogId,
            context.tenantId,
            context.storeId,
            nextCatalogCode(catalogId),
            name,
            regularPriceFen,
            advancedPriceFen,
            timestamp,
            timestamp
          )
        importedCatalogItems += 1
      }
      target
        .prepare(
          `INSERT INTO legacy_id_mapping
           (id, tenant_id, entity_type, entity_id, legacy_source, legacy_table,
            legacy_id, import_batch_id, imported_at, checksum)
           VALUES (?, ?, 'catalog_item', ?, 'members.db',
                   'quick_deduct_items', ?, ?, ?, ?)`
        )
        .run(
          randomUUID(),
          context.tenantId,
          catalogId,
          legacy.id,
          batchId,
          timestamp,
          checksum(legacy)
        )
      if (resolution) {
        target
          .prepare(
            `INSERT INTO legacy_import_resolution
             (id, tenant_id, import_batch_id, conflict_type, legacy_id,
              resolution_json)
             VALUES (?, ?, ?, 'catalog', ?, ?)`
          )
          .run(
            randomUUID(),
            context.tenantId,
            batchId,
            legacy.id,
            JSON.stringify(resolution)
          )
      }
    }

    const resultSummary = {
      inspection: inspection.summary,
      importedMembers,
      mergedMembers,
      openingBalanceFen,
      importedFinancialHistory:
        rows.transactions.length + rows.activityLogs.length,
      importedMonthlyCards,
      importedCatalogItems
    }
    target
      .prepare(
        `UPDATE legacy_import_batch SET summary_json = ? WHERE id = ?`
      )
      .run(JSON.stringify(resultSummary), batchId)
    appendBatchAuditAndOutbox(
      target,
      context,
      batchId,
      resultSummary,
      timestamp
    )
    if (input.prepareCloudSync === true) {
      prepareLegacyImportCloudSyncInOpenTransaction(
        target,
        context,
        {
          id: batchId,
          imported_by: context.actor.id,
          imported_at: timestamp
        },
        now
      )
    }
    target.exec('COMMIT')
    return {
      batchId,
      importedAt: timestamp,
      summary: inspection.summary,
      importedMembers,
      mergedMembers,
      openingBalanceFen,
      importedFinancialHistory:
        rows.transactions.length + rows.activityLogs.length,
      importedMonthlyCards,
      importedCatalogItems
    }
  } catch (error) {
    target.exec('ROLLBACK')
    throw error
  }
}
