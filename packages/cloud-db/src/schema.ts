import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
}

export const tenants = pgTable('tenant', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  ...timestamps
})

export const stores = pgTable(
  'store',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Asia/Shanghai'),
    address: text('address'),
    contactPhone: text('contact_phone'),
    businessOpenMinute: integer('business_open_minute').notNull().default(780),
    businessCloseMinute: integer('business_close_minute')
      .notNull()
      .default(1380),
    statusOverride: text('status_override').notNull().default('automatic'),
    customStatusText: text('custom_status_text'),
    status: text('status').notNull().default('active'),
    ...timestamps
  },
  (table) => [index('idx_store_tenant').on(table.tenantId)]
)

export const devices = pgTable(
  'device',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    name: text('name').notNull(),
    credentialHash: text('credential_hash'),
    status: text('status').notNull().default('pending'),
    lastDeviceSeq: bigint('last_device_seq', { mode: 'number' })
      .notNull()
      .default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    index('idx_device_tenant_store').on(table.tenantId, table.storeId)
  ]
)

export const cloudEmployees = pgTable(
  'cloud_employee',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull(),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('uq_cloud_employee_tenant_username').on(
      table.tenantId,
      table.username
    ),
    index('idx_cloud_employee_store').on(
      table.tenantId,
      table.storeId,
      table.status
    )
  ]
)

export const cloudEmployeeMobileCredentials = pgTable(
  'cloud_employee_mobile_credential',
  {
    employeeId: uuid('employee_id')
      .primaryKey()
      .references(() => cloudEmployees.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    enabled: boolean('enabled').notNull().default(false),
    passwordHash: text('password_hash'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('idx_cloud_employee_mobile_credential_store').on(
      table.tenantId,
      table.storeId,
      table.enabled
    )
  ]
)

export const cloudEmployeePcCredentials = pgTable(
  'cloud_employee_pc_credential',
  {
    employeeId: uuid('employee_id')
      .primaryKey()
      .references(() => cloudEmployees.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    passwordHash: text('password_hash').notNull(),
    credentialVersion: bigint('credential_version', { mode: 'number' })
      .notNull()
      .default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('idx_cloud_employee_pc_credential_tenant').on(
      table.tenantId,
      table.updatedAt
    )
  ]
)

export const tenantAdministrators = pgTable(
  'tenant_administrator',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => cloudEmployees.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('active'),
    ...timestamps
  },
  (table) => [
    uniqueIndex('uq_tenant_administrator').on(
      table.tenantId,
      table.employeeId
    )
  ]
)

export const cloudEmployeeStoreAccess = pgTable(
  'cloud_employee_store_access',
  {
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => cloudEmployees.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    role: text('role').notNull(),
    status: text('status').notNull(),
    authorizationVersion: bigint('authorization_version', { mode: 'number' })
      .notNull()
      .default(1),
    grantedBy: uuid('granted_by').references(() => cloudEmployees.id),
    ...timestamps
  },
  (table) => [
    uniqueIndex('uq_employee_store_access').on(
      table.employeeId,
      table.storeId
    ),
    index('idx_employee_store_access_store').on(
      table.tenantId,
      table.storeId,
      table.status,
      table.role
    )
  ]
)

export const cloudMembers = pgTable(
  'cloud_member',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    memberNumber: text('member_number').notNull(),
    phone: text('phone').notNull(),
    nickname: text('nickname').notNull(),
    avatarUrl: text('avatar_url'),
    profileCompleted: boolean('profile_completed').notNull().default(false),
    tier: text('tier').notNull(),
    status: text('status').notNull(),
    birthdayMonth: integer('birthday_month'),
    birthdayDay: integer('birthday_day'),
    birthdaySource: text('birthday_source'),
    note: text('note'),
    source: text('source').notNull(),
    ageGateStatus: text('age_gate_status')
      .notNull()
      .default('confirmed_at_least_14'),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('uq_cloud_member_tenant_number').on(
      table.tenantId,
      table.memberNumber
    ),
    uniqueIndex('uq_cloud_member_tenant_phone').on(
      table.tenantId,
      table.phone
    ),
    index('idx_cloud_member_store').on(
      table.tenantId,
      table.storeId,
      table.status
    )
  ]
)

export const miniappIdentities = pgTable(
  'miniapp_identity',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    memberId: uuid('member_id').references(() => cloudMembers.id),
    employeeId: uuid('employee_id').references(() => cloudEmployees.id),
    status: text('status').notNull().default('active'),
    ...timestamps
  },
  (table) => [
    uniqueIndex('uq_miniapp_identity_provider_subject').on(
      table.tenantId,
      table.provider,
      table.providerSubject
    ),
    index('idx_miniapp_identity_member').on(table.tenantId, table.memberId),
    index('idx_miniapp_identity_employee').on(
      table.tenantId,
      table.employeeId
    )
  ]
)

export const miniappSessions = pgTable(
  'miniapp_session',
  {
    id: uuid('id').primaryKey(),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => miniappIdentities.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('uq_miniapp_session_token_hash').on(table.tokenHash),
    index('idx_miniapp_session_identity_expiry').on(
      table.identityId,
      table.expiresAt
    )
  ]
)

export const cashierCommands = pgTable(
  'cashier_command',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => cloudEmployees.id),
    requestId: text('request_id').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull().default('pending'),
    commandJson: jsonb('command_json').notNull(),
    claimedByDevice: uuid('claimed_by_device').references(() => devices.id),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    localOrderId: uuid('local_order_id'),
    resultJson: jsonb('result_json'),
    errorMessage: text('error_message'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('uq_cashier_command_employee_request').on(
      table.tenantId,
      table.requestedBy,
      table.requestId
    ),
    index('idx_cashier_command_store_status').on(
      table.storeId,
      table.status,
      table.createdAt
    ),
    index('idx_cashier_command_claim_lease').on(
      table.storeId,
      table.leaseExpiresAt
    ),
    index('idx_cashier_command_expiry').on(table.expiresAt)
  ]
)

export const employeeFinancialCommands = pgTable(
  'employee_financial_command',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => cloudEmployees.id),
    requestId: text('request_id').notNull(),
    requestHash: text('request_hash').notNull(),
    commandType: text('command_type').notNull(),
    status: text('status').notNull().default('pending'),
    commandJson: jsonb('command_json').notNull(),
    claimedByDevice: uuid('claimed_by_device').references(() => devices.id),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    resultJson: jsonb('result_json'),
    errorMessage: text('error_message'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('uq_employee_financial_command_employee_request').on(
      table.tenantId,
      table.requestedBy,
      table.requestId
    ),
    index('idx_employee_financial_command_store_status').on(
      table.storeId,
      table.status,
      table.createdAt
    ),
    index('idx_employee_financial_command_claim_lease').on(
      table.storeId,
      table.leaseExpiresAt
    ),
    index('idx_employee_financial_command_expiry').on(table.expiresAt)
  ]
)

export const phoneVerificationChallenges = pgTable(
  'phone_verification_challenge',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => miniappIdentities.id),
    phone: text('phone').notNull(),
    purpose: text('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('idx_phone_verification_identity').on(
      table.identityId,
      table.purpose,
      table.createdAt
    ),
    index('idx_phone_verification_expiry').on(table.expiresAt)
  ]
)

export const cloudCatalogItems = pgTable(
  'cloud_catalog_item',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    itemType: text('item_type').notNull(),
    regularPriceFen: bigint('regular_price_fen', { mode: 'number' }).notNull(),
    advancedPriceFen: bigint('advanced_price_fen', { mode: 'number' }).notNull(),
    status: text('status').notNull(),
    availability: text('availability').notNull(),
    note: text('note'),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('uq_cloud_catalog_store_code').on(table.storeId, table.code),
    index('idx_cloud_catalog_store').on(
      table.tenantId,
      table.storeId,
      table.status
    )
  ]
)

export const cloudActivityCampaigns = pgTable(
  'cloud_activity_campaign',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    content: text('content').notNull(),
    activityType: text('activity_type').notNull(),
    status: text('status').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    pinned: boolean('pinned').notNull().default(false),
    regularPriceFen: bigint('regular_price_fen', { mode: 'number' }),
    advancedPriceFen: bigint('advanced_price_fen', { mode: 'number' }),
    allowStoredValue: boolean('allow_stored_value').notNull().default(true),
    allowWechat: boolean('allow_wechat').notNull().default(true),
    rechargeTiersJson: jsonb('recharge_tiers_json').notNull(),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('idx_cloud_activity_schedule').on(
      table.tenantId,
      table.storeId,
      table.status,
      table.startsAt,
      table.endsAt
    )
  ]
)

export const cloudAnnouncements = pgTable(
  'cloud_announcement',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    title: text('title').notNull(),
    content: text('content').notNull(),
    status: text('status').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    visibleFrom: timestamp('visible_from', { withTimezone: true }).notNull(),
    visibleUntil: timestamp('visible_until', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('idx_cloud_announcement_visibility').on(
      table.tenantId,
      table.storeId,
      table.status,
      table.pinned,
      table.visibleFrom,
      table.visibleUntil
    )
  ]
)

export const cloudBoardGames = pgTable(
  'cloud_board_game',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    name: text('name').notNull(),
    introduction: text('introduction').notNull(),
    categoriesJson: jsonb('categories_json').notNull(),
    minPlayers: integer('min_players').notNull(),
    maxPlayers: integer('max_players').notNull(),
    minMinutes: integer('min_minutes'),
    maxMinutes: integer('max_minutes'),
    difficulty: text('difficulty').notNull(),
    complexityRating: numeric('complexity_rating', {
      precision: 2,
      scale: 1,
      mode: 'number'
    }),
    quantity: integer('quantity').notNull(),
    recordStatus: text('record_status').notNull(),
    available: boolean('available').notNull().default(true),
    customerConsigned: boolean('customer_consigned').notNull().default(false),
    missingPieces: boolean('missing_pieces').notNull().default(false),
    private: boolean('private').notNull().default(false),
    recommended: boolean('recommended').notNull().default(false),
    imageUrl: text('image_url'),
    bggId: bigint('bgg_id', { mode: 'number' }),
    metadataSource: text('metadata_source'),
    metadataImportedAt: timestamp('metadata_imported_at', {
      withTimezone: true
    }),
    customerNote: text('customer_note'),
    internalNote: text('internal_note'),
    consignorNickname: text('consignor_nickname'),
    missingPartsJson: jsonb('missing_parts_json').notNull(),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('uq_cloud_board_game_tenant_bgg_id')
      .on(table.tenantId, table.bggId)
      .where(sql`${table.bggId} is not null`),
    index('idx_cloud_board_game_public').on(
      table.tenantId,
      table.storeId,
      table.recordStatus,
      table.private,
      table.recommended,
      table.available
    )
  ]
)

export const miniappBoardGameLikes = pgTable(
  'miniapp_board_game_like',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    boardGameId: uuid('board_game_id')
      .notNull()
      .references(() => cloudBoardGames.id),
    viewerId: uuid('viewer_id')
      .notNull()
      .references(() => miniappIdentities.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('uq_miniapp_board_game_like_viewer_game').on(
      table.tenantId,
      table.storeId,
      table.boardGameId,
      table.viewerId
    ),
    index('idx_miniapp_board_game_like_game').on(
      table.tenantId,
      table.storeId,
      table.boardGameId
    ),
    index('idx_miniapp_board_game_like_viewer').on(
      table.tenantId,
      table.storeId,
      table.viewerId,
      table.createdAt
    )
  ]
)

export const cloudRechargeGiftTiers = pgTable(
  'cloud_recharge_gift_tier',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    principalFen: bigint('principal_fen', { mode: 'number' }).notNull(),
    giftFen: bigint('gift_fen', { mode: 'number' }).notNull(),
    active: boolean('active').notNull().default(true),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('uq_cloud_recharge_gift_store_principal').on(
      table.storeId,
      table.principalFen
    )
  ]
)

export const cloudWalletAccounts = pgTable(
  'cloud_wallet_account',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    memberId: uuid('member_id').notNull(),
    status: text('status').notNull(),
    principalBalanceFen: bigint('principal_balance_fen', {
      mode: 'number'
    }).notNull(),
    giftBalanceFen: bigint('gift_balance_fen', { mode: 'number' }).notNull(),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('uq_cloud_wallet_tenant_member').on(
      table.tenantId,
      table.memberId
    ),
    index('idx_cloud_wallet_member').on(table.tenantId, table.memberId)
  ]
)

export const cloudWalletLedger = pgTable(
  'cloud_wallet_ledger',
  {
    operationId: uuid('operation_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    walletAccountId: uuid('wallet_account_id')
      .notNull()
      .references(() => cloudWalletAccounts.id),
    memberId: uuid('member_id').notNull(),
    eventType: text('event_type').notNull(),
    sourceOperationId: text('source_operation_id').notNull(),
    principalDeltaFen: bigint('principal_delta_fen', {
      mode: 'number'
    }).notNull(),
    giftDeltaFen: bigint('gift_delta_fen', { mode: 'number' }).notNull(),
    principalBalanceAfterFen: bigint('principal_balance_after_fen', {
      mode: 'number'
    }).notNull(),
    giftBalanceAfterFen: bigint('gift_balance_after_fen', {
      mode: 'number'
    }).notNull(),
    reason: text('reason'),
    payloadJson: jsonb('payload_json').notNull(),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('idx_cloud_wallet_ledger_account').on(
      table.tenantId,
      table.walletAccountId,
      table.occurredAt
    )
  ]
)

export const cloudMembershipGrants = pgTable(
  'cloud_membership_grant',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => cloudMembers.id),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    grantedTier: text('granted_tier').notNull(),
    reason: text('reason').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true })
  },
  (table) => [
    uniqueIndex('uq_cloud_membership_grant_source').on(
      table.tenantId,
      table.sourceType,
      table.sourceId
    ),
    index('idx_cloud_membership_grant_active').on(
      table.tenantId,
      table.memberId,
      table.revokedAt
    )
  ]
)

export const wechatRechargeOrders = pgTable(
  'wechat_recharge_order',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => cloudMembers.id),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => miniappIdentities.id),
    requestId: text('request_id').notNull(),
    requestHash: text('request_hash').notNull(),
    outTradeNo: text('out_trade_no').notNull(),
    providerMode: text('provider_mode').notNull(),
    providerPrepayId: text('provider_prepay_id'),
    providerTransactionId: text('provider_transaction_id'),
    principalFen: bigint('principal_fen', { mode: 'number' }).notNull(),
    giftFen: bigint('gift_fen', { mode: 'number' }).notNull(),
    giftRuleSnapshotJson: jsonb('gift_rule_snapshot_json').notNull(),
    clientPaymentJson: jsonb('client_payment_json'),
    status: text('status').notNull(),
    errorMessage: text('error_message'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('uq_wechat_recharge_order_out_trade_no').on(table.outTradeNo),
    uniqueIndex('uq_wechat_recharge_order_provider_transaction').on(
      table.providerTransactionId
    ),
    uniqueIndex('uq_wechat_recharge_order_identity_request').on(
      table.tenantId,
      table.identityId,
      table.requestId
    ),
    index('idx_wechat_recharge_order_member').on(
      table.tenantId,
      table.memberId,
      table.createdAt
    ),
    index('idx_wechat_recharge_order_status_expiry').on(
      table.status,
      table.expiresAt
    )
  ]
)

export const cloudMonthlyCards = pgTable(
  'cloud_monthly_card',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    memberId: uuid('member_id').notNull(),
    planName: text('plan_name').notNull(),
    priceFen: bigint('price_fen', { mode: 'number' }).notNull(),
    paymentMethod: text('payment_method').notNull(),
    status: text('status').notNull(),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    usageCount: integer('usage_count').notNull(),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    scopeType: text('scope_type').notNull().default('store')
  },
  (table) => [
    index('idx_cloud_monthly_card_member').on(
      table.tenantId,
      table.memberId,
      table.purchasedAt
    )
  ]
)

export const wechatMonthlyCardOrders = pgTable(
  'wechat_monthly_card_order',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => cloudMembers.id),
    identityId: uuid('identity_id')
      .notNull()
      .references(() => miniappIdentities.id),
    requestId: text('request_id').notNull(),
    requestHash: text('request_hash').notNull(),
    outTradeNo: text('out_trade_no').notNull(),
    providerMode: text('provider_mode').notNull(),
    providerPrepayId: text('provider_prepay_id'),
    providerTransactionId: text('provider_transaction_id'),
    planName: text('plan_name').notNull(),
    priceFen: bigint('price_fen', { mode: 'number' }).notNull(),
    durationDays: integer('duration_days').notNull(),
    scopeType: text('scope_type').notNull(),
    clientPaymentJson: jsonb('client_payment_json'),
    status: text('status').notNull(),
    targetCardId: uuid('target_card_id').references(() => cloudMonthlyCards.id),
    expiresBefore: timestamp('expires_before', { withTimezone: true }),
    expiresAfter: timestamp('expires_after', { withTimezone: true }),
    errorMessage: text('error_message'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('uq_wechat_monthly_card_order_out_trade_no').on(
      table.outTradeNo
    ),
    uniqueIndex('uq_wechat_monthly_card_order_provider_transaction').on(
      table.providerTransactionId
    ),
    uniqueIndex('uq_wechat_monthly_card_order_identity_request').on(
      table.tenantId,
      table.identityId,
      table.requestId
    ),
    index('idx_wechat_monthly_card_order_member').on(
      table.tenantId,
      table.memberId,
      table.createdAt
    ),
    index('idx_wechat_monthly_card_order_status').on(
      table.status,
      table.expiresAt
    )
  ]
)

export const paymentCallbackInbox = pgTable(
  'payment_callback_inbox',
  {
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    orderId: uuid('order_id').references(() => wechatRechargeOrders.id),
    monthlyCardOrderId: uuid('monthly_card_order_id').references(
      () => wechatMonthlyCardOrders.id
    ),
    status: text('status').notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    errorMessage: text('error_message'),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true })
  },
  (table) => [
    uniqueIndex('uq_payment_callback_inbox_provider_event').on(
      table.provider,
      table.eventId
    ),
    index('idx_payment_callback_inbox_order').on(
      table.orderId,
      table.receivedAt
    ),
    index('idx_payment_callback_inbox_monthly_card_order').on(
      table.monthlyCardOrderId,
      table.receivedAt
    )
  ]
)

export const cloudMonthlyCardEvents = pgTable(
  'cloud_monthly_card_event',
  {
    operationId: uuid('operation_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    cardId: uuid('card_id').notNull().references(() => cloudMonthlyCards.id),
    memberId: uuid('member_id').notNull(),
    eventType: text('event_type').notNull(),
    reason: text('reason'),
    payloadJson: jsonb('payload_json').notNull(),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull()
  },
  (table) => [
    index('idx_cloud_monthly_card_event_card').on(
      table.tenantId,
      table.cardId,
      table.occurredAt
    )
  ]
)

export const cloudSalesOrders = pgTable(
  'cloud_sales_order',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    orderNumber: text('order_number').notNull(),
    visitBatchId: uuid('visit_batch_id').notNull(),
    customerMemberId: uuid('customer_member_id'),
    paymentMethod: text('payment_method').notNull(),
    walletMemberId: uuid('wallet_member_id'),
    status: text('status').notNull(),
    totalFen: bigint('total_fen', { mode: 'number' }).notNull(),
    note: text('note'),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull()
  },
  (table) => [
    uniqueIndex('uq_cloud_sales_order_tenant_number').on(
      table.tenantId,
      table.orderNumber
    ),
    index('idx_cloud_sales_order_store_time').on(
      table.tenantId,
      table.storeId,
      table.completedAt
    )
  ]
)

export const cloudSalesOrderItems = pgTable(
  'cloud_sales_order_item',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    orderId: uuid('order_id').notNull().references(() => cloudSalesOrders.id),
    catalogItemId: uuid('catalog_item_id').notNull(),
    itemName: text('item_name').notNull(),
    itemType: text('item_type').notNull(),
    regularPriceFen: bigint('regular_price_fen', { mode: 'number' }).notNull(),
    advancedPriceFen: bigint('advanced_price_fen', { mode: 'number' }).notNull(),
    appliedUnitPriceFen: bigint('applied_unit_price_fen', {
      mode: 'number'
    }).notNull(),
    pricingTier: text('pricing_tier').notNull(),
    quantity: integer('quantity').notNull(),
    lineTotalFen: bigint('line_total_fen', { mode: 'number' }).notNull(),
    benefitType: text('benefit_type').notNull(),
    beneficiaryMemberId: uuid('beneficiary_member_id')
  },
  (table) => [
    index('idx_cloud_sales_order_item_order').on(
      table.tenantId,
      table.orderId
    )
  ]
)

export const cloudRefundRequests = pgTable(
  'cloud_refund_request',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    refundNumber: text('refund_number').notNull(),
    orderId: uuid('order_id').notNull(),
    orderNumber: text('order_number').notNull(),
    paymentMethod: text('payment_method').notNull(),
    walletMemberId: uuid('wallet_member_id'),
    status: text('status').notNull(),
    totalFen: bigint('total_fen', { mode: 'number' }).notNull(),
    requestedBy: uuid('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    payloadJson: jsonb('payload_json').notNull(),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('uq_cloud_refund_tenant_number').on(
      table.tenantId,
      table.refundNumber
    ),
    index('idx_cloud_refund_store_time').on(
      table.tenantId,
      table.storeId,
      table.requestedAt
    )
  ]
)

export const cloudRefundEvents = pgTable('cloud_refund_event', {
  operationId: uuid('operation_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  storeId: uuid('store_id').notNull().references(() => stores.id),
  refundId: uuid('refund_id').notNull().references(() => cloudRefundRequests.id),
  eventType: text('event_type').notNull(),
  payloadJson: jsonb('payload_json').notNull(),
  serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull()
})

export const cloudFinancialRefundRequests = pgTable(
  'cloud_financial_refund_request',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    requestNumber: text('request_number').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    memberId: uuid('member_id').notNull(),
    paymentMethod: text('payment_method').notNull(),
    status: text('status').notNull(),
    refundPrincipalFen: bigint('refund_principal_fen', {
      mode: 'number'
    }).notNull(),
    reclaimGiftFen: bigint('reclaim_gift_fen', { mode: 'number' }).notNull(),
    requestedBy: uuid('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    payloadJson: jsonb('payload_json').notNull(),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex('uq_cloud_financial_refund_tenant_number').on(
      table.tenantId,
      table.requestNumber
    ),
    index('idx_cloud_financial_refund_store_time').on(
      table.tenantId,
      table.storeId,
      table.requestedAt
    )
  ]
)

export const cloudFinancialRefundEvents = pgTable(
  'cloud_financial_refund_event',
  {
    operationId: uuid('operation_id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    financialRefundId: uuid('financial_refund_id')
      .notNull()
      .references(() => cloudFinancialRefundRequests.id),
    eventType: text('event_type').notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    serverVersion: bigint('server_version', { mode: 'number' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull()
  }
)

export const syncOperations = pgTable(
  'sync_operation',
  {
    operationId: uuid('operation_id').primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    deviceSeq: bigint('device_seq', { mode: 'number' }).notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    actorId: uuid('actor_id'),
    operationType: text('operation_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    baseVersion: bigint('base_version', { mode: 'number' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    payloadHash: text('payload_hash').notNull(),
    protocolVersion: integer('protocol_version').notNull().default(1),
    changedFields: jsonb('changed_fields'),
    status: text('status').notNull().default('received'),
    serverVersion: bigint('server_version', { mode: 'number' }),
    resultJson: jsonb('result_json'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('uq_sync_operation_device_seq').on(
      table.deviceId,
      table.deviceSeq
    ),
    index('idx_sync_operation_store_received').on(
      table.tenantId,
      table.storeId,
      table.receivedAt
    )
  ]
)

export const syncConflicts = pgTable(
  'sync_conflict',
  {
    id: uuid('id').primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => syncOperations.operationId),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    conflictType: text('conflict_type').notNull(),
    localPayloadJson: jsonb('local_payload_json').notNull(),
    serverPayloadJson: jsonb('server_payload_json'),
    status: text('status').notNull().default('pending'),
    resolutionJson: jsonb('resolution_json'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('uq_sync_conflict_operation').on(table.operationId),
    index('idx_sync_conflict_store_status').on(
      table.tenantId,
      table.storeId,
      table.status
    )
  ]
)

export const cloudEvents = pgTable(
  'cloud_event',
  {
    sequence: bigserial('sequence', { mode: 'number' }).primaryKey(),
    eventId: uuid('event_id').notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payloadJson: jsonb('payload_json').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('uq_cloud_event_id').on(table.eventId),
    index('idx_cloud_event_store_sequence').on(
      table.tenantId,
      table.storeId,
      table.sequence
    )
  ]
)

export const cloudAuditLogs = pgTable(
  'cloud_audit_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    deviceId: uuid('device_id').references(() => devices.id),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    metadataJson: jsonb('metadata_json').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index('idx_cloud_audit_store_time').on(
      table.tenantId,
      table.storeId,
      table.occurredAt
    )
  ]
)

export const idempotencyKeys = pgTable(
  'api_idempotency',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: bigint('response_status', { mode: 'number' }),
    responseJson: jsonb('response_json'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('uq_api_idempotency_tenant_key').on(table.tenantId, table.key),
    index('idx_api_idempotency_expiry').on(table.expiresAt)
  ]
)

export const schemaConstraints = {
  deviceSequencePositive: sql`${devices.lastDeviceSeq} >= 0`,
  syncSequencePositive: sql`${syncOperations.deviceSeq} > 0`
}
