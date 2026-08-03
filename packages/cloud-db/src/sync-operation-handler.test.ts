import { describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import {
  classifySyncOperation,
  parseAnnouncementProjection,
  parseActivityProjection,
  parseBoardGameProjection,
  parseCatalogProjection,
  parseEmployeeProjection,
  parseMemberProjection,
  parseStoreProfileProjection,
  processSyncOperation,
  type ReceivedOperation
} from './sync-operation-handler'

function operation(
  operationType: string,
  after: Record<string, unknown>
): ReceivedOperation {
  return {
    operation_id: 'operation-1',
    device_id: 'device-1',
    device_seq: 1,
    tenant_id: 'tenant-1',
    store_id: 'store-1',
    actor_id: 'actor-1',
    operation_type: operationType,
    aggregate_id: 'aggregate-1',
    occurred_at: new Date('2026-06-13T00:00:00.000Z'),
    payload_json: { action: operationType, after }
  }
}

describe('cloud sync operation projections', () => {
  it('classifies business and audit-only operations', () => {
    expect(classifySyncOperation('employee.created')).toBe('employee')
    expect(classifySyncOperation('store.profile.updated')).toBe('store')
    expect(classifySyncOperation('member.created')).toBe('member')
    expect(classifySyncOperation('catalog.item.updated')).toBe('catalog')
    expect(classifySyncOperation('activity.published')).toBe('activity')
    expect(classifySyncOperation('announcement.published')).toBe('announcement')
    expect(classifySyncOperation('board_game.updated')).toBe('board_game')
    expect(classifySyncOperation('system.cloud.connected')).toBe('audit')
    expect(classifySyncOperation('wallet.debited')).toBe('financial')
    expect(classifySyncOperation('monthly_card.used')).toBe('financial')
    expect(classifySyncOperation('order.completed')).toBe('financial')
    expect(classifySyncOperation('refund.completed')).toBe('financial')
  })

  it('parses store hours including schedules that cross midnight', () => {
    expect(
      parseStoreProfileProjection(
        operation('store.profile.updated', {
          name: 'Night Store',
          address: null,
          contactPhone: '13800138000',
          businessOpenMinute: 18 * 60,
          businessCloseMinute: 2 * 60,
          statusOverride: 'automatic',
          customStatusText: null
        })
      )
    ).toMatchObject({
      name: 'Night Store',
      businessOpenMinute: 1080,
      businessCloseMinute: 120
    })
  })

  it('parses announcement and board-game public content projections', () => {
    expect(
      parseAnnouncementProjection(
        operation('announcement.published', {
          title: 'Holiday hours',
          content: 'Open from 13:00.',
          status: 'published',
          pinned: true,
          visibleFrom: '2026-10-01T00:00:00.000Z',
          visibleUntil: null,
          publishedAt: '2026-09-30T00:00:00.000Z'
        })
      )
    ).toMatchObject({ status: 'published', pinned: true })

    expect(
      parseBoardGameProjection(
        operation('board_game.updated', {
          name: 'Cascadia',
          introduction: 'A family strategy game.',
          categories: ['Family', 'Strategy'],
          minPlayers: 1,
          maxPlayers: 4,
          minMinutes: 30,
          maxMinutes: 45,
          difficulty: 'light',
          complexityRating: 2.3,
          quantity: 2,
          recordStatus: 'active',
          available: true,
          customerConsigned: true,
          missingPieces: true,
          private: false,
          recommended: true,
          imageUrl: null,
          bggId: 295947,
          metadataSource: 'bgg',
          metadataImportedAt: '2026-08-03T00:00:00.000Z',
          customerNote: 'Ask staff for help.',
          internalNote: 'Private note',
          consignorNickname: 'Alice',
          missingParts: [{ id: 'part-1', name: 'Token', quantity: 2 }]
        })
      )
    ).toMatchObject({
      name: 'Cascadia',
      categories: ['Family', 'Strategy'],
      complexityRating: 2.3,
      metadataSource: 'bgg',
      metadataImportedAt: '2026-08-03T00:00:00.000Z',
      missingParts: [{ name: 'Token', quantity: 2 }]
    })

    expect(() =>
      parseBoardGameProjection(
        operation('board_game.updated', {
          name: 'Invalid complexity',
          introduction: 'Must be rejected.',
          categories: ['Strategy'],
          minPlayers: 1,
          maxPlayers: 4,
          minMinutes: 30,
          maxMinutes: 45,
          difficulty: 'light',
          complexityRating: 5.01,
          quantity: 1,
          recordStatus: 'active',
          available: true,
          customerConsigned: false,
          missingPieces: false,
          private: false,
          recommended: false,
          imageUrl: null,
          bggId: null,
          metadataSource: null,
          metadataImportedAt: null,
          customerNote: null,
          internalNote: null,
          consignorNickname: null,
          missingParts: []
        })
      )
    ).toThrow(/complexity/i)
  })

  it('parses activity schedules and integer-fen recharge tiers', () => {
    expect(
      parseActivityProjection(
        operation('activity.published', {
          title: 'Holiday recharge',
          summary: 'Recharge gift activity',
          content: 'Recharge during the event.',
          activityType: 'recharge',
          status: 'published',
          startsAt: '2026-10-01T00:00:00.000Z',
          endsAt: '2026-10-08T00:00:00.000Z',
          pinned: true,
          regularPriceFen: null,
          advancedPriceFen: null,
          allowStoredValue: false,
          allowWechat: true,
          rechargeTiers: [
            {
              id: 'tier-1',
              principalFen: 30_000,
              giftFen: 3_000
            }
          ]
        })
      )
    ).toMatchObject({
      status: 'published',
      rechargeTiers: [{ principalFen: 30_000, giftFen: 3_000 }]
    })
  })

  it('parses employee, member, and integer-fen catalog snapshots', () => {
    expect(
      parseEmployeeProjection(
        operation('employee.created', {
          username: 'STAFF',
          displayName: 'Staff',
          role: 'staff',
          status: 'active'
        })
      )
    ).toMatchObject({ username: 'staff', role: 'staff' })

    expect(
      parseMemberProjection(
        operation('member.created', {
          memberNumber: 'M001',
          phone: '13800138000',
          nickname: 'Member',
          tier: 'ordinary',
          status: 'active',
          birthdayMonth: null,
          birthdayDay: null,
          birthdaySource: null,
          note: null,
          source: 'desktop',
          ageGate: 'under_14_verified'
        })
      )
    ).toMatchObject({
      phone: '13800138000',
      tier: 'ordinary',
      ageGate: 'under_14_verified'
    })

    expect(
      parseCatalogProjection(
        operation('catalog.item.created', {
          code: 'C001',
          name: 'Admission',
          itemType: 'admission',
          regularPriceFen: 4000,
          advancedPriceFen: 3000,
          status: 'active',
          availability: 'available',
          note: null
        })
      )
    ).toMatchObject({ regularPriceFen: 4000, advancedPriceFen: 3000 })
  })

  it('rejects floating point money and malformed member snapshots', () => {
    expect(() =>
      parseCatalogProjection(
        operation('catalog.item.created', {
          code: 'C001',
          name: 'Admission',
          itemType: 'admission',
          regularPriceFen: 40.5,
          advancedPriceFen: 3000,
          status: 'active',
          availability: 'available',
          note: null
        })
      )
    ).toThrow('regularPriceFen')

    expect(() =>
      parseMemberProjection(
        operation('member.created', {
          memberNumber: 'M001',
          phone: '',
          nickname: 'Member',
          tier: 'ordinary',
          status: 'active',
          source: 'desktop'
        })
      )
    ).toThrow('member.phone')
  })

  it('applies tenant-level tier reconciliation from another occurrence store', async () => {
    const calls: Array<{ sql: string; parameters: unknown[] }> = []
    const client = {
      query: async (sql: string, parameters: unknown[] = []) => {
        calls.push({ sql, parameters })
        if (sql.includes('SELECT tenant_id, store_id')) {
          return {
            rows: [{ tenant_id: 'tenant-1', store_id: 'origin-store' }],
            rowCount: 1
          }
        }
        if (sql.includes('SELECT tenant_id FROM cloud_member')) {
          return { rows: [{ tenant_id: 'tenant-1' }], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO cloud_event')) {
          return { rows: [{ sequence: 31 }], rowCount: 1 }
        }
        return { rows: [], rowCount: 1 }
      }
    } as unknown as PoolClient

    const result = await processSyncOperation(
      client,
      operation('member.tier.reconciled', {
        tier: 'advanced',
        updatedAt: '2026-07-26T10:00:00.000Z'
      }),
      async () => 'confirmed'
    )

    expect(result).toBe('confirmed')
    const memberWrite = calls.find((call) =>
      call.sql.includes('UPDATE cloud_member')
    )
    expect(memberWrite?.sql).toContain('SET tier = $3')
    expect(memberWrite?.sql).not.toContain('nickname')
    expect(memberWrite?.parameters).toEqual([
      'aggregate-1',
      'tenant-1',
      'advanced',
      31,
      '2026-07-26T10:00:00.000Z'
    ])
  })

  it('stores a mobile password hash but strips it from cloud events', async () => {
    const calls: Array<{ sql: string; parameters: unknown[] }> = []
    const client = {
      query: async (sql: string, parameters: unknown[] = []) => {
        calls.push({ sql, parameters })
        if (sql.includes('SELECT access.status')) {
          return { rows: [{ status: 'active' }], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO cloud_event')) {
          return { rows: [{ sequence: 12 }], rowCount: 1 }
        }
        return { rows: [], rowCount: 1 }
      }
    } as unknown as PoolClient
    const mobileHash = 'scrypt$16384$8$1$salt$hash'
    const result = await processSyncOperation(
      client,
      operation('employee.mobile_access.updated', {
        employeeId: 'aggregate-1',
        enabled: true,
        passwordHash: mobileHash,
        updatedAt: '2026-06-14T01:00:00.000Z'
      }),
      async () => 'confirmed'
    )

    expect(result).toBe('confirmed')
    const credentialWrite = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_employee_mobile_credential')
    )
    expect(credentialWrite?.parameters).toContain(mobileHash)
    const cloudEvent = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_event')
    )
    expect(JSON.stringify(cloudEvent?.parameters)).not.toContain(mobileHash)
    expect(JSON.parse(String(cloudEvent?.parameters[6]))).toMatchObject({
      after: { employeeId: 'aggregate-1', enabled: true }
    })
  })

  it('stores a desktop password hash and emits only its credential version', async () => {
    const calls: Array<{ sql: string; parameters: unknown[] }> = []
    const client = {
      query: async (sql: string, parameters: unknown[] = []) => {
        calls.push({ sql, parameters })
        if (sql.includes('SELECT employee.id::text')) {
          return { rows: [{ id: 'aggregate-1' }], rowCount: 1 }
        }
        if (sql.includes('SELECT credential_version')) {
          return { rows: [{ credential_version: '4' }], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO cloud_event')) {
          return { rows: [{ sequence: 20 }], rowCount: 1 }
        }
        return { rows: [], rowCount: 1 }
      }
    } as unknown as PoolClient
    const passwordHash = 'scrypt$16384$8$1$salt$desktop-hash'
    const result = await processSyncOperation(
      client,
      operation('employee.pc_credential.updated', {
        employeeId: 'aggregate-1',
        passwordHash,
        updatedAt: '2026-07-01T01:00:00.000Z'
      }),
      async () => 'confirmed'
    )
    expect(result).toBe('confirmed')
    const credentialWrite = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_employee_pc_credential')
    )
    expect(credentialWrite?.parameters).toContain(passwordHash)
    expect(credentialWrite?.parameters).toContain(5)
    const cloudEvent = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_event')
    )
    expect(JSON.stringify(cloudEvent?.parameters)).not.toContain(passwordHash)
    expect(JSON.parse(String(cloudEvent?.parameters[6]))).toMatchObject({
      after: { employeeId: 'aggregate-1', credentialVersion: 5 }
    })
  })

  it('propagates mobile credential database failures for transaction rollback', async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes('SELECT access.status')) {
          return { rows: [{ status: 'active' }], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO cloud_employee_mobile_credential')) {
          throw new Error('database write failed')
        }
        return { rows: [], rowCount: 1 }
      }
    } as unknown as PoolClient

    await expect(
      processSyncOperation(
        client,
        operation('employee.mobile_access.updated', {
          employeeId: 'aggregate-1',
          enabled: true,
          passwordHash: 'scrypt$16384$8$1$salt$hash',
          updatedAt: '2026-06-14T01:00:00.000Z'
        }),
        async () => 'confirmed'
      )
    ).rejects.toThrow('database write failed')
  })

  it('merges disjoint v2 fields changed by different devices', async () => {
    const calls: Array<{ sql: string; parameters: unknown[] }> = []
    const client = {
      query: async (sql: string, parameters: unknown[] = []) => {
        calls.push({ sql, parameters })
        if (sql.includes('ORDER BY sequence DESC')) {
          return {
            rows: [
              {
                sequence: 7,
                payload_json: {
                  after: {
                    title: 'Old title',
                    content: 'Remote content',
                    status: 'published',
                    pinned: false,
                    visibleFrom: '2026-06-01T00:00:00.000Z',
                    visibleUntil: null,
                    publishedAt: '2026-06-01T00:00:00.000Z',
                    createdAt: '2026-06-01T00:00:00.000Z',
                    updatedAt: '2026-06-30T07:00:00.000Z'
                  }
                }
              }
            ]
          }
        }
        if (sql.includes('sequence > $5')) {
          return {
            rows: [
              {
                payload_json: {
                  before: { content: 'Old content' },
                  after: { content: 'Remote content' }
                }
              }
            ]
          }
        }
        if (sql.includes('SELECT tenant_id, store_id')) {
          return { rows: [{ tenant_id: 'tenant-1', store_id: 'store-1' }] }
        }
        if (sql.includes('INSERT INTO cloud_event')) {
          return { rows: [{ sequence: 8 }], rowCount: 1 }
        }
        return { rows: [], rowCount: 1 }
      }
    } as unknown as PoolClient
    const command = operation('announcement.updated', {
      title: 'Local title',
      content: 'Old content',
      status: 'published',
      pinned: false,
      visibleFrom: '2026-06-01T00:00:00.000Z',
      visibleUntil: null,
      publishedAt: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-30T08:00:00.000Z'
    })
    command.base_version = 5
    command.changed_fields = ['title']
    command.payload_json.before = {
      ...(command.payload_json.after as Record<string, unknown>),
      title: 'Old title'
    }

    await expect(
      processSyncOperation(client, command, async () => 'confirmed')
    ).resolves.toBe('confirmed')
    const write = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_announcement')
    )
    expect(write?.parameters).toContain('Local title')
    expect(write?.parameters).toContain('Remote content')
  })

  it('routes overlapping v2 fields to the conflict center', async () => {
    const client = {
      query: async (sql: string) => {
        if (sql.includes('ORDER BY sequence DESC')) {
          return {
            rows: [
              {
                sequence: 7,
                payload_json: { after: { title: 'Remote title' } }
              }
            ]
          }
        }
        if (sql.includes('sequence > $5')) {
          return {
            rows: [
              {
                payload_json: {
                  before: { title: 'Old title' },
                  after: { title: 'Remote title' }
                }
              }
            ]
          }
        }
        if (sql.includes('INSERT INTO cloud_event')) {
          return { rows: [{ sequence: 8 }], rowCount: 1 }
        }
        return { rows: [], rowCount: 1 }
      }
    } as unknown as PoolClient
    const command = operation('announcement.updated', {
      title: 'Local title'
    })
    command.base_version = 5
    command.changed_fields = ['title']
    command.payload_json.before = { title: 'Old title' }

    await expect(
      processSyncOperation(client, command, async () => 'confirmed')
    ).resolves.toBe('conflict')
  })
})
