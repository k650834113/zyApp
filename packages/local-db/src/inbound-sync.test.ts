import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyPendingInboundEvents,
  applySyncPullResult,
  bootstrapStore,
  cashRecharge,
  createAnnouncement,
  createMember,
  debitWallet,
  findEmployeeRecordById,
  findPcOfflineCredential,
  getLocalSyncStatus,
  getWalletDetails,
  getStoreContext,
  getStoreProfile,
  listInboundSyncConflicts,
  listActivities,
  listAnnouncements,
  listBoardGames,
  openLocalDatabase,
  resolveInboundSyncConflict,
  savePcOfflineCredential,
  searchMembers
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function payload(after: Record<string, unknown>): string {
  return JSON.stringify({ action: 'cloud.updated', after })
}

describe('safe inbound event application', () => {
  it('applies store-specific employee roles and invalidates older offline authorization', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-inbound-access-'))
    temporaryDirectories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    const bootstrap = bootstrapStore(local.connection, {
      storeName: 'Store B',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier B'
    })
    const context = getStoreContext(local.connection)
    if (!context) throw new Error('Missing store')
    savePcOfflineCredential(
      local.connection,
      context,
      {
        employee: {
          id: bootstrap.managerId,
          username: 'manager',
          displayName: 'Manager',
          role: 'manager',
          status: 'active'
        },
        tenantId: context.tenantId,
        storeId: context.storeId,
        deviceId: context.deviceId,
        credentialVersion: 1,
        authorizationVersion: 3,
        serverTime: '2026-07-01T00:00:00.000Z',
        offlineValidUntil: '2026-07-31T00:00:00.000Z'
      },
      'encrypted-verifier'
    )
    applySyncPullResult(local.connection, context, {
      protocolVersion: 1,
      deviceId: context.deviceId,
      afterCursor: null,
      nextCursor: '1',
      hasMore: false,
      serverTime: '2026-07-02T00:00:00.000Z',
      events: [{
        sequence: '1',
        eventId: '99999999-9999-4999-8999-999999999991',
        tenantId: context.tenantId,
        storeId: context.storeId,
        originDeviceId: null,
        aggregateType: 'employee',
        aggregateId: bootstrap.managerId,
        eventType: 'employee.authorization.updated',
        payloadJson: payload({
          id: bootstrap.managerId,
          username: 'manager',
          displayName: 'Manager',
          role: 'staff',
          status: 'active',
          authorizationVersion: 4,
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-02T00:00:00.000Z'
        }),
        occurredAt: '2026-07-02T00:00:00.000Z'
      }]
    })
    expect(applyPendingInboundEvents(local.connection, context)).toMatchObject({
      applied: 1,
      conflicts: 0
    })
    expect(findEmployeeRecordById(
      local.connection,
      context.tenantId,
      bootstrap.managerId
    )?.role).toBe('staff')
    expect(findPcOfflineCredential(
      local.connection,
      context,
      'manager'
    )?.invalidatedAt).toBe('2026-07-02T00:00:00.000Z')
    local.close()
  })

  it('applies a cloud WeChat recharge additively beside pending offline debits', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-inbound-wallet-'))
    temporaryDirectories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    const bootstrap = bootstrapStore(local.connection, {
      storeName: 'Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier'
    })
    const context = getStoreContext(local.connection)
    if (!context) throw new Error('Missing store')
    const actor = findEmployeeRecordById(
      local.connection,
      context.tenantId,
      bootstrap.managerId
    )
    if (!actor) throw new Error('Missing manager')
    const member = createMember(
      local.connection,
      { ...context, actor },
      {
        phone: '13800138000',
        nickname: 'Wallet Member',
        confirmedAtLeast14: true
      }
    )
    cashRecharge(
      local.connection,
      { ...context, actor },
      {
        requestId: 'initial-cash-recharge',
        memberId: member.id,
        principalFen: 50_000,
        reason: 'Initial balance'
      }
    )
    local.connection.exec(
      "UPDATE outbox_operation SET sync_status = 'confirmed'"
    )
    debitWallet(
      local.connection,
      { ...context, actor },
      {
        requestId: 'offline-debit-before-cloud-recharge',
        memberId: member.id,
        amountFen: 10_000,
        reason: 'Offline order'
      }
    )
    const pendingBefore = getLocalSyncStatus(
      local.connection,
      context
    ).pendingOperations
    const rechargeId = '88888888-8888-4888-8888-888888888888'
    applySyncPullResult(local.connection, context, {
      protocolVersion: 1,
      deviceId: context.deviceId,
      afterCursor: null,
      nextCursor: '1',
      hasMore: false,
      events: [
        {
          sequence: '1',
          eventId: '99999999-9999-4999-8999-999999999999',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: null,
          aggregateType: 'wallet_recharge',
          aggregateId: rechargeId,
          eventType: 'wallet.wechat_recharged',
          payloadJson: payload({
            rechargeId,
            paymentOrderId: rechargeId,
            memberId: member.id,
            principalFen: 30_000,
            giftFen: 2_000,
            giftRuleSnapshot: { activity: 'summer' },
            providerTransactionId: 'wechat-transaction-1',
            membershipGrantId: null,
            occurredAt: '2026-06-14T02:00:00.000Z'
          }),
          occurredAt: '2026-06-14T02:00:00.000Z'
        }
      ],
      serverTime: '2026-06-14T02:00:00.000Z'
    })

    expect(applyPendingInboundEvents(local.connection, context)).toEqual({
      applied: 1,
      conflicts: 0,
      skippedSuperseded: 0
    })
    expect(getWalletDetails(local.connection, context, member.id).wallet).toMatchObject({
      principalBalanceFen: 75_000,
      giftBalanceFen: 2_000,
      totalBalanceFen: 77_000
    })
    expect(
      local.connection
        .prepare(
          `SELECT payment_method, principal_fen, gift_fen
           FROM wallet_recharge WHERE id = ?`
        )
        .get(rechargeId)
    ).toEqual({
      payment_method: 'wechat',
      principal_fen: 30_000,
      gift_fen: 2_000
    })
    expect(
      getLocalSyncStatus(local.connection, context).pendingOperations
    ).toBe(pendingBefore)
    expect(
      local.connection
        .prepare(
          `SELECT entry_type FROM wallet_ledger WHERE source_id = ?`
        )
        .get(rechargeId)
    ).toEqual({ entry_type: 'wechat_recharge' })
    local.close()
  })

  it('applies mobile access state without receiving a password hash', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-inbound-mobile-'))
    temporaryDirectories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    const bootstrap = bootstrapStore(local.connection, {
      storeName: 'Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier'
    })
    const context = getStoreContext(local.connection)
    if (!context) throw new Error('Missing store')
    local.connection.exec(
      "UPDATE outbox_operation SET sync_status = 'confirmed'"
    )
    local.connection
      .prepare(
        `INSERT INTO employee_mobile_credential
         (employee_id, tenant_id, store_id, enabled, password_hash, updated_at)
         VALUES (?, ?, ?, 1, 'local-secret-hash', ?)`
      )
      .run(
        bootstrap.managerId,
        context.tenantId,
        context.storeId,
        '2026-06-14T00:00:00.000Z'
      )

    applySyncPullResult(local.connection, context, {
      protocolVersion: 1,
      deviceId: context.deviceId,
      afterCursor: null,
      nextCursor: '1',
      hasMore: false,
      events: [
        {
          sequence: '1',
          eventId: 'employee-mobile-disabled',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: 'other-device',
          aggregateType: 'employee_mobile_access',
          aggregateId: bootstrap.managerId,
          eventType: 'employee.mobile_access.updated',
          payloadJson: payload({
            employeeId: bootstrap.managerId,
            enabled: false,
            updatedAt: '2026-06-14T01:00:00.000Z'
          }),
          occurredAt: '2026-06-14T01:00:00.000Z'
        }
      ],
      serverTime: '2026-06-14T01:00:00.000Z'
    })

    expect(applyPendingInboundEvents(local.connection, context)).toEqual({
      applied: 1,
      conflicts: 0,
      skippedSuperseded: 0
    })
    expect(
      local.connection
        .prepare(
          `SELECT enabled, password_hash FROM employee_mobile_credential
           WHERE employee_id = ?`
        )
        .get(bootstrap.managerId)
    ).toEqual({ enabled: 0, password_hash: null })
    expect(
      findEmployeeRecordById(
        local.connection,
        context.tenantId,
        bootstrap.managerId
      )?.mobileAccessEnabled
    ).toBe(false)
    local.close()
  })

  it('applies public non-financial projections without creating an outbox loop', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-inbound-'))
    temporaryDirectories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    const bootstrap = bootstrapStore(local.connection, {
      storeName: 'Original Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier'
    })
    const context = getStoreContext(local.connection)
    if (!context) throw new Error('Missing store')
    local.connection.exec(
      "UPDATE outbox_operation SET sync_status = 'confirmed'"
    )
    const createdAt = '2026-06-14T00:00:00.000Z'
    const updatedAt = '2026-06-14T01:00:00.000Z'

    applySyncPullResult(local.connection, context, {
      protocolVersion: 1,
      deviceId: context.deviceId,
      afterCursor: null,
      nextCursor: '6',
      hasMore: false,
      events: [
        {
          sequence: '1',
          eventId: 'store-event',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: 'other-device',
          aggregateType: 'store',
          aggregateId: context.storeId,
          eventType: 'store.profile.updated',
          payloadJson: payload({
            storeId: context.storeId,
            name: 'Cloud Store',
            address: 'Cloud Road',
            contactPhone: '13800138000',
            businessOpenMinute: 18 * 60,
            businessCloseMinute: 2 * 60,
            statusOverride: 'automatic',
            customStatusText: null,
            updatedAt
          }),
          occurredAt: updatedAt
        },
        {
          sequence: '2',
          eventId: 'announcement-event',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: 'other-device',
          aggregateType: 'announcement',
          aggregateId: 'announcement-cloud',
          eventType: 'announcement.published',
          payloadJson: payload({
            id: 'announcement-cloud',
            title: 'Cloud notice',
            content: 'Cloud content',
            status: 'published',
            pinned: true,
            visibleFrom: createdAt,
            visibleUntil: null,
            publishedAt: updatedAt,
            createdAt,
            updatedAt
          }),
          occurredAt: updatedAt
        },
        {
          sequence: '3',
          eventId: 'activity-event',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: 'other-device',
          aggregateType: 'activity',
          aggregateId: 'activity-cloud',
          eventType: 'activity.published',
          payloadJson: payload({
            id: 'activity-cloud',
            title: 'Cloud activity',
            summary: 'Summary',
            content: 'Content',
            activityType: 'general',
            status: 'published',
            startsAt: createdAt,
            endsAt: '2026-07-14T00:00:00.000Z',
            pinned: false,
            regularPriceFen: null,
            advancedPriceFen: null,
            allowStoredValue: true,
            allowWechat: true,
            rechargeTiers: [],
            createdAt,
            updatedAt
          }),
          occurredAt: updatedAt
        },
        {
          sequence: '4',
          eventId: 'board-game-event',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: 'other-device',
          aggregateType: 'board_game',
          aggregateId: 'board-game-cloud',
          eventType: 'board_game.updated',
          payloadJson: payload({
            id: 'board-game-cloud',
            name: 'Cloud Game',
            introduction: 'Introduction',
            categories: ['Strategy'],
            minPlayers: 2,
            maxPlayers: 4,
            minMinutes: 30,
            maxMinutes: 60,
            difficulty: 'medium',
            complexityRating: 2.3,
            quantity: 2,
            recordStatus: 'active',
            available: true,
            customerConsigned: false,
            missingPieces: true,
            private: false,
            recommended: true,
            imageUrl: 'https://example.com/game.jpg',
            localImagePath: 'must-not-be-used',
            bggId: 123,
            metadataSource: 'bgg',
            metadataImportedAt: '2026-08-03T00:00:00.000Z',
            customerNote: 'Public note',
            internalNote: 'Internal note',
            consignorNickname: null,
            missingParts: [
              { id: 'part-cloud', name: 'Token', quantity: 1 }
            ],
            createdAt,
            updatedAt
          }),
          occurredAt: updatedAt
        },
        {
          sequence: '5',
          eventId: 'catalog-event',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: 'other-device',
          aggregateType: 'catalog',
          aggregateId: 'catalog-cloud',
          eventType: 'catalog.item.updated',
          payloadJson: payload({
            id: 'catalog-cloud',
            code: 'CLOUD001',
            name: 'Cloud service',
            itemType: 'service',
            regularPriceFen: 2500,
            advancedPriceFen: 2000,
            status: 'active',
            availability: 'available',
            note: 'Future orders only',
            createdAt,
            updatedAt
          }),
          occurredAt: updatedAt
        },
        {
          sequence: '6',
          eventId: 'member-event',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: null,
          aggregateType: 'member',
          aggregateId: 'member-cloud',
          eventType: 'member.created',
          payloadJson: payload({
            id: 'member-cloud',
            memberNumber: 'MCLOUD001',
            phone: '13900139000',
            nickname: 'Miniapp member',
            tier: 'ordinary',
            status: 'active',
            birthdayMonth: null,
            birthdayDay: null,
            birthdaySource: null,
            note: null,
            source: 'miniapp',
            ageGate: 'recharge_disabled',
            createdAt,
            updatedAt
          }),
          occurredAt: updatedAt
        }
      ],
      serverTime: updatedAt
    })

    expect(
      applyPendingInboundEvents(local.connection, context)
    ).toEqual({ applied: 6, conflicts: 0, skippedSuperseded: 0 })
    expect(getStoreProfile(local.connection, context)).toMatchObject({
      name: 'Cloud Store',
      businessOpenMinute: 1080,
      businessCloseMinute: 120
    })
    expect(listAnnouncements(local.connection, context)).toHaveLength(1)
    expect(listActivities(local.connection, context)).toHaveLength(1)
    expect(listBoardGames(local.connection, context)[0]).toMatchObject({
      name: 'Cloud Game',
      complexityRating: 2.3,
      metadataSource: 'bgg',
      metadataImportedAt: '2026-08-03T00:00:00.000Z',
      localImagePath: null,
      missingParts: [{ name: 'Token', quantity: 1 }]
    })
    expect(
      local.connection
        .prepare(
          `SELECT complexity_tenths, metadata_source, metadata_imported_at
           FROM board_game WHERE id = 'board-game-cloud'`
        )
        .get()
    ).toEqual({
      complexity_tenths: 23,
      metadata_source: 'bgg',
      metadata_imported_at: '2026-08-03T00:00:00.000Z'
    })
    expect(
      local.connection
        .prepare(
          `SELECT name, regular_price_fen, advanced_price_fen
           FROM catalog_item WHERE id = 'catalog-cloud'`
        )
        .get()
    ).toEqual({
      name: 'Cloud service',
      regular_price_fen: 2500,
      advanced_price_fen: 2000
    })
    expect(
      searchMembers(local.connection, context.tenantId, '13900139000', 10)[0]
    ).toMatchObject({
      id: 'member-cloud',
      source: 'miniapp',
      ageGate: 'recharge_disabled'
    })
    const actor = findEmployeeRecordById(
      local.connection,
      context.tenantId,
      bootstrap.managerId
    )
    if (!actor) throw new Error('Missing manager')
    expect(() =>
      cashRecharge(
        local.connection,
        { ...context, actor },
        {
          requestId: 'recharge-disabled-member',
          memberId: 'member-cloud',
          principalFen: 30000,
          reason: 'Must be rejected'
        }
      )
    ).toThrow('requires age confirmation')
    local.connection
      .prepare(
        `UPDATE member
         SET age_gate_status = 'under_14_verified'
         WHERE id = 'member-cloud'`
      )
      .run()
    expect(
      cashRecharge(
        local.connection,
        { ...context, actor },
        {
          requestId: 'recharge-guardian-verified',
          memberId: 'member-cloud',
          principalFen: 30000,
          reason: 'Guardian verified'
        }
      ).wallet.totalBalanceFen
    ).toBe(32000)
    expect(getLocalSyncStatus(local.connection, context)).toMatchObject({
      pendingInboundEvents: 0,
      inboundConflicts: 0
    })
    expect(
      local.connection
        .prepare(
          `SELECT COUNT(*) count FROM outbox_operation
           WHERE sync_status = 'pending'
             AND operation_type NOT LIKE 'wallet.%'`
        )
        .get()
    ).toEqual({ count: 1 })
    expect(
      local.connection
        .prepare(
          `SELECT operation_type, aggregate_id
           FROM outbox_operation
           WHERE operation_type = 'member.tier.reconciled'`
        )
        .get()
    ).toEqual({
      operation_type: 'member.tier.reconciled',
      aggregate_id: 'member-cloud'
    })

    local.close()
  })

  it('marks a conflict instead of overwriting an aggregate with local pending changes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-inbound-conflict-'))
    temporaryDirectories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    const bootstrap = bootstrapStore(local.connection, {
      storeName: 'Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier'
    })
    const context = getStoreContext(local.connection)
    if (!context) throw new Error('Missing store')
    const actor = findEmployeeRecordById(
      local.connection,
      context.tenantId,
      bootstrap.managerId
    )
    if (!actor) throw new Error('Missing manager')
    const localAnnouncement = createAnnouncement(
      local.connection,
      { ...context, actor },
      {
        title: 'Local notice',
        content: 'Local content',
        pinned: false,
        visibleFrom: '2026-06-14T00:00:00.000Z'
      }
    )
    applySyncPullResult(local.connection, context, {
      protocolVersion: 1,
      deviceId: context.deviceId,
      afterCursor: null,
      nextCursor: '1',
      hasMore: false,
      events: [
        {
          sequence: '1',
          eventId: 'conflicting-event',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: 'other-device',
          aggregateType: 'announcement',
          aggregateId: localAnnouncement.id,
          eventType: 'announcement.updated',
          payloadJson: payload({
            ...localAnnouncement,
            title: 'Cloud overwrite attempt'
          }),
          occurredAt: '2026-06-14T01:00:00.000Z'
        }
      ],
      serverTime: '2026-06-14T01:00:00.000Z'
    })

    expect(
      applyPendingInboundEvents(local.connection, context)
    ).toEqual({ applied: 0, conflicts: 1, skippedSuperseded: 0 })
    expect(listAnnouncements(local.connection, context)[0]?.title).toBe(
      'Local notice'
    )
    expect(getLocalSyncStatus(local.connection, context)).toMatchObject({
      pendingInboundEvents: 0,
      inboundConflicts: 1
    })
    expect(listInboundSyncConflicts(local.connection, context)).toHaveLength(1)
    resolveInboundSyncConflict(
      local.connection,
      { ...context, actor },
      {
        sequence: '1',
        resolution: 'keep_local',
        reason: 'Local draft is newer'
      }
    )
    expect(listInboundSyncConflicts(local.connection, context)).toHaveLength(0)
    expect(listAnnouncements(local.connection, context)[0]?.title).toBe(
      'Local notice'
    )

    local.close()
  })

  it('requires local pending changes to clear before a manager applies cloud data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-inbound-resolve-'))
    temporaryDirectories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    const bootstrap = bootstrapStore(local.connection, {
      storeName: 'Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier'
    })
    const context = getStoreContext(local.connection)
    if (!context) throw new Error('Missing store')
    const actor = findEmployeeRecordById(
      local.connection,
      context.tenantId,
      bootstrap.managerId
    )
    if (!actor) throw new Error('Missing manager')
    const localAnnouncement = createAnnouncement(
      local.connection,
      { ...context, actor },
      {
        title: 'Local title',
        content: 'Local content',
        pinned: false,
        visibleFrom: '2026-06-14T00:00:00.000Z'
      }
    )
    applySyncPullResult(local.connection, context, {
      protocolVersion: 1,
      deviceId: context.deviceId,
      afterCursor: null,
      nextCursor: '1',
      hasMore: false,
      events: [
        {
          sequence: '1',
          eventId: 'cloud-choice',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: 'other-device',
          aggregateType: 'announcement',
          aggregateId: localAnnouncement.id,
          eventType: 'announcement.updated',
          payloadJson: payload({
            ...localAnnouncement,
            title: 'Cloud title',
            updatedAt: '2026-06-14T01:00:00.000Z'
          }),
          occurredAt: '2026-06-14T01:00:00.000Z'
        }
      ],
      serverTime: '2026-06-14T01:00:00.000Z'
    })
    applyPendingInboundEvents(local.connection, context)

    expect(() =>
      resolveInboundSyncConflict(
        local.connection,
        { ...context, actor },
        {
          sequence: '1',
          resolution: 'apply_cloud',
          reason: 'Use cloud copy'
        }
      )
    ).toThrow('Local changes are still pending')
    local.connection
      .prepare(
        `UPDATE outbox_operation SET sync_status = 'confirmed'
         WHERE aggregate_id = ?`
      )
      .run(localAnnouncement.id)
    resolveInboundSyncConflict(
      local.connection,
      { ...context, actor },
      {
        sequence: '1',
        resolution: 'apply_cloud',
        reason: 'Use cloud copy'
      }
    )
    expect(listAnnouncements(local.connection, context)[0]?.title).toBe(
      'Cloud title'
    )

    local.close()
  })

  it('routes a duplicate member phone to the inbound conflict center', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-member-conflict-'))
    temporaryDirectories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    const bootstrap = bootstrapStore(local.connection, {
      storeName: 'Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier'
    })
    const context = getStoreContext(local.connection)
    if (!context) throw new Error('Missing store')
    const actor = findEmployeeRecordById(
      local.connection,
      context.tenantId,
      bootstrap.managerId
    )
    if (!actor) throw new Error('Missing manager')
    createAnnouncement(
      local.connection,
      { ...context, actor },
      {
        title: 'Unrelated local operation',
        content: 'Keeps the outbox realistic',
        pinned: false,
        visibleFrom: '2026-06-14T00:00:00.000Z'
      }
    )
    const existingMember = createMember(
      local.connection,
      { ...context, actor },
      {
        phone: '13800138000',
        nickname: 'Existing member',
        confirmedAtLeast14: true
      }
    )
    local.connection
      .prepare(
        `UPDATE outbox_operation SET sync_status = 'confirmed'
         WHERE aggregate_id = ?`
      )
      .run(existingMember.id)
    applySyncPullResult(local.connection, context, {
      protocolVersion: 1,
      deviceId: context.deviceId,
      afterCursor: null,
      nextCursor: '1',
      hasMore: false,
      events: [
        {
          sequence: '1',
          eventId: 'duplicate-phone-member',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: null,
          aggregateType: 'member',
          aggregateId: 'another-member-id',
          eventType: 'member.created',
          payloadJson: payload({
            id: 'another-member-id',
            memberNumber: 'MCLOUD002',
            phone: '13800138000',
            nickname: 'Cloud duplicate',
            tier: 'ordinary',
            status: 'active',
            birthdayMonth: null,
            birthdayDay: null,
            birthdaySource: null,
            note: null,
            source: 'miniapp',
            ageGate: 'confirmed_at_least_14',
            createdAt: '2026-06-14T00:00:00.000Z',
            updatedAt: '2026-06-14T00:00:00.000Z'
          }),
          occurredAt: '2026-06-14T00:00:00.000Z'
        }
      ],
      serverTime: '2026-06-14T00:00:00.000Z'
    })

    expect(
      applyPendingInboundEvents(local.connection, context)
    ).toEqual({ applied: 0, conflicts: 1, skippedSuperseded: 0 })
    expect(listInboundSyncConflicts(local.connection, context)[0]).toMatchObject({
      aggregateType: 'member',
      aggregateId: 'another-member-id'
    })
    expect(
      searchMembers(local.connection, context.tenantId, '13800138000', 10)
    ).toHaveLength(1)

    local.close()
  })

  it('does not apply an older remote event superseded by a later local-origin event', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-inbound-order-'))
    temporaryDirectories.push(directory)
    const local = openLocalDatabase(join(directory, 'zyapp.db'))
    bootstrapStore(local.connection, {
      storeName: 'Store',
      managerUsername: 'manager',
      managerPasswordHash: 'scrypt$test',
      managerDisplayName: 'Manager',
      deviceName: 'Cashier'
    })
    const context = getStoreContext(local.connection)
    if (!context) throw new Error('Missing store')
    local.connection.exec(
      "UPDATE outbox_operation SET sync_status = 'confirmed'"
    )
    const common = {
      id: 'announcement-shared',
      content: 'Content',
      status: 'published',
      pinned: false,
      visibleFrom: '2026-06-14T00:00:00.000Z',
      visibleUntil: null,
      publishedAt: '2026-06-14T00:00:00.000Z',
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T01:00:00.000Z'
    }
    applySyncPullResult(local.connection, context, {
      protocolVersion: 1,
      deviceId: context.deviceId,
      afterCursor: null,
      nextCursor: '2',
      hasMore: false,
      events: [
        {
          sequence: '1',
          eventId: 'remote-older',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: 'other-device',
          aggregateType: 'announcement',
          aggregateId: 'announcement-shared',
          eventType: 'announcement.updated',
          payloadJson: payload({ ...common, title: 'Older remote title' }),
          occurredAt: '2026-06-14T00:30:00.000Z'
        },
        {
          sequence: '2',
          eventId: 'local-newer',
          tenantId: context.tenantId,
          storeId: context.storeId,
          originDeviceId: context.deviceId,
          aggregateType: 'announcement',
          aggregateId: 'announcement-shared',
          eventType: 'announcement.updated',
          payloadJson: payload({ ...common, title: 'Newer local title' }),
          occurredAt: '2026-06-14T01:00:00.000Z'
        }
      ],
      serverTime: '2026-06-14T01:00:00.000Z'
    })

    expect(
      applyPendingInboundEvents(local.connection, context)
    ).toEqual({ applied: 0, conflicts: 0, skippedSuperseded: 1 })
    expect(listAnnouncements(local.connection, context)).toHaveLength(0)
    expect(
      local.connection
        .prepare(
          `SELECT apply_status, error_message FROM sync_inbound_event
           WHERE sequence = '1'`
        )
        .get()
    ).toEqual({
      apply_status: 'skipped_origin',
      error_message: 'superseded_by_later_local_origin'
    })

    local.close()
  })
})
