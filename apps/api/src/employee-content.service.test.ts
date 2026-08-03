import { describe, expect, it } from 'vitest'
import type { Pool } from '@zyapp/cloud-db'
import type { MiniappPrincipal } from './miniapp-auth'
import { EmployeeContentService } from './employee-content.service'

type QueryCall = {
  sql: string
  parameters: unknown[]
}

const tenantId = '11111111-1111-4111-8111-111111111111'
const storeId = '22222222-2222-4222-8222-222222222222'
const employeeId = '33333333-3333-4333-8333-333333333333'
const boardGameId = '44444444-4444-4444-8444-444444444444'

function principal(role: 'manager' | 'staff' = 'manager'): MiniappPrincipal {
  return {
    identityId: '55555555-5555-4555-8555-555555555555',
    tenantId,
    storeId,
    provider: 'development',
    providerSubject: `${role}-user`,
    memberId: null,
    memberStatus: null,
    employeeId,
    employeeStatus: 'active',
    employeeRole: role,
    identity: {
      role,
      employeeId,
      displayName: role === 'manager' ? 'Manager' : 'Staff',
      permissions:
        role === 'manager'
          ? [
              'content.manage',
              'content.read',
              'content.board-game.operations.manage',
              'store.profile.manage'
            ]
          : ['content.read', 'content.board-game.operations.manage']
    }
  }
}

function boardGameRow() {
  return {
    id: boardGameId,
    name: 'Catan',
    introduction: 'Trade and build.',
    categories_json: ['strategy'],
    min_players: 3,
    max_players: 4,
    min_minutes: 60,
    max_minutes: 120,
    difficulty: 'medium',
    complexity_rating: '2.3',
    quantity: 2,
    record_status: 'active',
    available: true,
    customer_consigned: false,
    missing_pieces: false,
    private: false,
    recommended: true,
    image_url: null,
    bgg_id: 13,
    metadata_source: 'bgg',
    metadata_imported_at: '2026-08-03T00:00:00.000Z',
    customer_note: null,
    internal_note: null,
    consignor_nickname: null,
    missing_parts_json: [],
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z'
  }
}

describe('employee content service', () => {
  it('creates an announcement draft with event, projection and audit', async () => {
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      if (sql.includes('INSERT INTO api_idempotency')) {
        return { rows: [{ key: parameters[1] }], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        return { rows: [{ sequence: 61 }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    }
    const client = { query, release() {} }
    const service = new EmployeeContentService({
      connect: async () => client,
      query
    } as unknown as Pool)

    const result = await service.createAnnouncement(principal(), {
      requestId: 'announcement-create-1',
      title: 'Temporary hours',
      content: 'The store opens one hour later tomorrow.',
      pinned: true,
      visibleFrom: '2026-06-14T00:00:00.000Z',
      visibleUntil: '2026-06-16T00:00:00.000Z'
    })

    expect(result).toMatchObject({
      status: 'draft',
      title: 'Temporary hours',
      pinned: true
    })
    const event = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_event')
    )
    expect(event?.parameters[3]).toBe('announcement')
    expect(event?.parameters[5]).toBe('announcement.created')
    const projection = calls.find((call) =>
      call.sql.includes('INSERT INTO cloud_announcement')
    )
    expect(projection?.parameters[10]).toBe(61)
    expect(
      calls.some((call) => call.sql.includes('INSERT INTO cloud_audit_log'))
    ).toBe(true)
  })

  it('lets staff update operational board-game fields without changing base data', async () => {
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      if (sql.includes('INSERT INTO api_idempotency')) {
        return { rows: [{ key: parameters[1] }], rowCount: 1 }
      }
      if (sql.includes('FROM cloud_board_game') && sql.includes('FOR UPDATE')) {
        return { rows: [boardGameRow()], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        return { rows: [{ sequence: 62 }], rowCount: 1 }
      }
      if (sql.includes('UPDATE cloud_board_game')) {
        return { rows: [{ id: boardGameId }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    }
    const client = { query, release() {} }
    const service = new EmployeeContentService({
      connect: async () => client,
      query
    } as unknown as Pool)

    const result = await service.updateBoardGameOperations(
      principal('staff'),
      {
        requestId: 'board-operations-1',
        boardGameId,
        available: true,
        customerConsigned: true,
        missingPieces: true,
        private: false,
        customerNote: 'Ask staff before use.',
        internalNote: 'Stored on shelf B.',
        consignorNickname: 'Lin',
        missingParts: [{ name: 'red cube', quantity: 2 }],
        reason: 'Checked during opening shift'
      }
    )

    expect(result).toMatchObject({
      id: boardGameId,
      name: 'Catan',
      quantity: 2,
      complexityRating: 2.3,
      metadataSource: 'bgg',
      metadataImportedAt: '2026-08-03T00:00:00.000Z',
      customerConsigned: true,
      missingPieces: true,
      consignorNickname: 'Lin',
      missingParts: [{ name: 'red cube', quantity: 2 }]
    })
    const update = calls.find((call) =>
      call.sql.includes('UPDATE cloud_board_game')
    )
    expect(update?.sql).not.toMatch(/(?:SET|,)\s*name\s*=/)
    expect(update?.sql).not.toMatch(/(?:SET|,)\s*quantity\s*=/)
    expect(update?.parameters[11]).toBe(62)
    const select = calls.find((call) =>
      call.sql.includes('FROM cloud_board_game') && call.sql.includes('FOR UPDATE')
    )
    expect(select?.sql).toContain('complexity_rating')
    expect(select?.sql).toContain('metadata_source')
  })

  it('does not let mobile operations publish a legacy game without complexity', async () => {
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      if (sql.includes('INSERT INTO api_idempotency')) {
        return { rows: [{ key: parameters[1] }], rowCount: 1 }
      }
      if (sql.includes('FROM cloud_board_game') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{ ...boardGameRow(), complexity_rating: null, private: true }],
          rowCount: 1
        }
      }
      return { rows: [], rowCount: 1 }
    }
    const client = { query, release() {} }
    const service = new EmployeeContentService({
      connect: async () => client,
      query
    } as unknown as Pool)

    await expect(service.updateBoardGameOperations(principal('staff'), {
      requestId: 'board-operations-no-complexity',
      boardGameId,
      available: true,
      customerConsigned: false,
      missingPieces: false,
      private: false,
      missingParts: [],
      reason: 'Attempt to publish legacy game'
    })).rejects.toThrow(/复杂度/)
    expect(calls.some((call) =>
      call.sql.includes('INSERT INTO cloud_event')
    )).toBe(false)
  })

  it('updates only the mobile store status fields and denies manager content to staff', async () => {
    const calls: QueryCall[] = []
    const query = async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters })
      if (sql.includes('INSERT INTO api_idempotency')) {
        return { rows: [{ key: parameters[1] }], rowCount: 1 }
      }
      if (sql.includes('FROM store') && sql.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              id: storeId,
              name: 'Board Game Cafe',
              address: 'Test road',
              contact_phone: '010-12345678',
              business_open_minute: 780,
              business_close_minute: 1380,
              status_override: 'automatic',
              custom_status_text: null,
              updated_at: '2026-06-01T00:00:00.000Z'
            }
          ],
          rowCount: 1
        }
      }
      if (sql.includes('INSERT INTO cloud_event')) {
        return { rows: [{ sequence: 63 }], rowCount: 1 }
      }
      if (sql.includes('UPDATE store')) {
        return { rows: [{ id: storeId }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    }
    const client = { query, release() {} }
    const service = new EmployeeContentService({
      connect: async () => client,
      query
    } as unknown as Pool)

    const result = await service.updateStoreStatus(principal(), {
      requestId: 'store-status-1',
      statusOverride: 'closed',
      customStatusText: 'Private event tonight',
      reason: 'Close public entry for private event'
    })

    expect(result).toMatchObject({
      name: 'Board Game Cafe',
      businessOpenMinute: 780,
      statusOverride: 'closed',
      customStatusText: 'Private event tonight'
    })
    const update = calls.find((call) => call.sql.includes('UPDATE store'))
    expect(update?.sql).not.toContain('name =')
    expect(update?.sql).not.toContain('business_open_minute')

    await expect(
      service.listAnnouncements(principal('staff'))
    ).rejects.toThrow('当前身份没有此内容管理权限')
    await expect(service.getStoreProfile(principal('staff'))).rejects.toThrow(
      '当前身份没有此内容管理权限'
    )
  })
})
