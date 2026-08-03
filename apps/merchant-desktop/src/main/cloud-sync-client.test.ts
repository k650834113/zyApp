import type { SyncPushBatch } from '@zyapp/sync-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimCloudCashierCommand,
  claimCloudEmployeeFinancialCommand,
  completeCloudCashierCommand,
  completeCloudEmployeeFinancialCommand,
  enrollCloudDevice,
  getCurrentCloudMirrorEpoch,
  getCloudBoardGameMetadataDetails,
  getCloudBoardGameMetadataStatus,
  getCloudOperationOutcome,
  getCloudSyncEvents,
  getCloudSyncResults,
  pushCloudSyncBatch,
  searchCloudBoardGameMetadata,
  streamCloudEventHints,
  submitCloudSyncCommand
} from './cloud-sync-client'

const connection = {
  environment: 'test' as const,
  baseUrl: 'http://127.0.0.1:3100',
  deviceId: 'device-1',
  token: 'secret-token'
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('desktop cloud sync client', () => {
  it('requests board-game metadata through device-authenticated cloud routes', async () => {
    const actorId = '44444444-4444-4444-8444-444444444444'
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        source: 'bgg', enabled: true, imagesEnabled: false
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        source: 'bgg', externalId: '13', primaryName: 'Catan',
        alternateNames: ['卡坦岛'], yearPublished: 1995,
        minPlayers: 3, maxPlayers: 4, minMinutes: 60, maxMinutes: 120,
        complexityRating: 2.3, categories: ['经营'], mechanics: ['交易'],
        thumbnailUrl: null, imageUrl: null,
        sourceUrl: 'https://boardgamegeek.com/boardgame/13',
        fetchedAt: '2026-08-03T00:00:00.000Z'
      }), { status: 200 }))

    await getCloudBoardGameMetadataStatus(connection, actorId, fetchMock)
    await searchCloudBoardGameMetadata(
      connection,
      actorId,
      { query: '卡坦岛' },
      fetchMock
    )
    await getCloudBoardGameMetadataDetails(
      connection,
      actorId,
      { source: 'bgg', externalId: '13' },
      fetchMock
    )

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${connection.baseUrl}/v1/board-game-metadata/status?actorId=${actorId}`
    )
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${connection.baseUrl}/v1/board-game-metadata/search?actorId=${actorId}&query=%E5%8D%A1%E5%9D%A6%E5%B2%9B`
    )
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `${connection.baseUrl}/v1/board-game-metadata/bgg/13?actorId=${actorId}`
    )
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).not.toHaveProperty('body')
      expect(call[1]?.headers).toMatchObject({
        authorization: 'Bearer secret-token',
        'x-zyapp-device-id': 'device-1'
      })
      expect(JSON.stringify(call[1]?.headers)).not.toContain('server-only')
    }
    expect(timeoutSpy.mock.calls.map(([milliseconds]) => milliseconds))
      .toEqual([10_000, 25_000, 25_000])
  })

  it('propagates metadata cloud errors without retrying in the renderer', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: 'BGG metadata is unavailable' }), {
        status: 503
      })
    )
    await expect(
      searchCloudBoardGameMetadata(
        connection,
        '44444444-4444-4444-8444-444444444444',
        { query: 'Catan' },
        fetchMock
      )
    ).rejects.toMatchObject({ status: 503 })
  })

  it('submits and resolves protocol v2 operations by id', async () => {
    const operation = {
      operationId: '44444444-4444-4444-8444-444444444444',
      deviceId: 'device-1',
      deviceSeq: 4,
      tenantId: 'tenant-1',
      storeId: 'store-1',
      actorId: null,
      operationType: 'member.updated',
      aggregateId: 'member-1',
      baseVersion: 3,
      occurredAt: '2026-06-30T08:00:00.000Z',
      payloadJson: '{}',
      payloadHash: 'a'.repeat(64),
      changedFields: ['nickname']
    }
    const result = {
      protocolVersion: 2,
      deviceId: 'device-1',
      outcome: {
        operationId: operation.operationId,
        status: 'confirmed',
        serverVersion: 8,
        conflictType: null,
        serverPayloadJson: null,
        resultJson: null
      },
      serverTime: '2026-06-30T08:00:01.000Z'
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(result), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )

    await expect(
      submitCloudSyncCommand(connection, operation, fetchMock)
    ).resolves.toMatchObject({ outcome: { status: 'confirmed' } })
    await expect(
      getCloudOperationOutcome(connection, operation.operationId, fetchMock)
    ).resolves.toMatchObject({ outcome: { serverVersion: 8 } })
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      '"protocolVersion":2'
    )
  })

  it('parses SSE cursor hints without exposing the device token', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: cloud-event\r\nid: 9\r\ndata: {"cursor":"9"}\r\n\r\n')
        )
        controller.close()
      }
    })
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    )
    const cursors: string[] = []
    await streamCloudEventHints(
      connection,
      {
        signal: new AbortController().signal,
        onCursor: (cursor) => cursors.push(cursor)
      },
      fetchMock
    )
    expect(cursors).toEqual(['9'])
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer secret-token'
    })
  })

  it('enrolls a device without returning the enrollment secret in request data', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          environment: 'test',
          tenantId: 'tenant-1',
          storeId: 'store-1',
          deviceId: 'device-1',
          deviceName: 'Cashier',
          token: 'issued-device-token'
        }),
        { status: 201, headers: { 'content-type': 'application/json' } }
      )
    )

    await expect(
      enrollCloudDevice(
        {
          environment: 'test',
          baseUrl: 'http://127.0.0.1:3100',
          enrollmentSecret: 'enrollment-secret',
          tenantId: 'tenant-1',
          storeId: 'store-1',
          deviceId: 'device-1',
          storeName: 'Store',
          deviceName: 'Cashier'
        },
        fetchMock
      )
    ).resolves.toMatchObject({ token: 'issued-device-token' })

    const options = fetchMock.mock.calls[0]?.[1]
    expect(options?.headers).toMatchObject({
      'x-zyapp-enrollment-secret': 'enrollment-secret'
    })
    expect(String(options?.body)).not.toContain('enrollment-secret')
    expect(String(options?.body)).toContain('"environment":"test"')
  })

  it('sends an authenticated sync batch without exposing credentials to renderer code', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: 1,
          deviceId: 'device-1',
          receipts: [{ operationId: 'operation-1', status: 'accepted' }],
          serverTime: '2026-06-13T00:00:00.000Z'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    const batch: SyncPushBatch = {
      protocolVersion: 1,
      deviceId: 'device-1',
      firstDeviceSeq: 1,
      lastDeviceSeq: 1,
      operations: []
    }

    await expect(
      pushCloudSyncBatch(connection, batch, fetchMock)
    ).resolves.toMatchObject({
      receipts: [{ status: 'accepted' }]
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3100/v1/sync/push',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret-token',
          'x-zyapp-device-id': 'device-1'
        })
      })
    )
  })

  it('polls only completed results and surfaces cloud errors', async () => {
    const success = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: 1,
          deviceId: 'device-1',
          receipts: [],
          serverTime: '2026-06-13T00:00:00.000Z'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    await getCloudSyncResults(connection, 8, 50, success)
    expect(success.mock.calls[0]?.[0]).toContain(
      'afterDeviceSeq=8&limit=50'
    )

    const failure = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: 'device disabled' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
    )
    await expect(
      getCloudSyncResults(connection, 0, 100, failure)
    ).rejects.toThrow('device disabled')
  })

  it('pulls cloud events with an opaque decimal cursor', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: 1,
          deviceId: 'device-1',
          afterCursor: '9007199254740993',
          nextCursor: '9007199254740994',
          hasMore: false,
          events: [],
          serverTime: '2026-06-14T00:00:00.000Z'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )

    await getCloudSyncEvents(
      connection,
      '9007199254740993',
      50,
      fetchMock
    )
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      'afterCursor=9007199254740993&limit=50'
    )
    await expect(
      getCloudSyncEvents(connection, '1e3', 100, fetchMock)
    ).rejects.toThrow('afterCursor must be a non-negative decimal integer')
  })

  it('claims and completes cashier commands through device-authenticated routes', async () => {
    const order = {
      id: '88888888-8888-4888-8888-888888888888',
      orderNumber: 'O20260614-12345678',
      visitBatchId: '99999999-9999-4999-8999-999999999999',
      customerMemberId: null,
      paymentMethod: 'cash' as const,
      walletMemberId: null,
      memberNickname: null,
      status: 'completed' as const,
      totalFen: 4000,
      note: null,
      completedAt: '2026-06-14T08:00:10.000Z',
      items: []
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            commandId: '55555555-5555-4555-8555-555555555555',
            requestedBy: '44444444-4444-4444-8444-444444444444',
            request: {
              requestId: '55555555-5555-4555-8555-555555555555',
              paymentMethod: 'cash',
              lines: []
            },
            leaseExpiresAt: '2026-06-14T08:00:45.000Z',
            expiresAt: '2026-06-14T08:10:00.000Z'
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            commandId: '55555555-5555-4555-8555-555555555555',
            requestId: 'mobile-order-1',
            status: 'completed',
            requestedBy: '44444444-4444-4444-8444-444444444444',
            claimedByDevice: 'device-1',
            localOrderId: order.id,
            result: order,
            errorMessage: null,
            createdAt: '2026-06-14T08:00:00.000Z',
            expiresAt: '2026-06-14T08:10:00.000Z',
            completedAt: '2026-06-14T08:00:10.000Z'
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        )
      )

    await claimCloudCashierCommand(connection, fetchMock)
    await completeCloudCashierCommand(
      connection,
      {
        commandId: '55555555-5555-4555-8555-555555555555',
        localOrderId: order.id,
        result: order
      },
      fetchMock
    )

    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      '/v1/devices/cashier-commands/claim'
    )
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      '/v1/devices/cashier-commands/55555555-5555-4555-8555-555555555555/complete'
    )
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer secret-token'
        })
      })
    )
  })

  it('treats an empty successful claim response as an idle command queue', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }))

    await expect(
      claimCloudCashierCommand(connection, fetchMock)
    ).resolves.toBeNull()
    await expect(
      claimCloudEmployeeFinancialCommand(connection, fetchMock)
    ).resolves.toBeNull()
  })

  it('treats an empty current-epoch response as a store that has not cut over yet', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }))

    await expect(
      getCurrentCloudMirrorEpoch(connection, fetchMock)
    ).resolves.toBeNull()
  })

  it('claims and completes employee financial commands through device routes', async () => {
    const commandId = '55555555-5555-4555-8555-555555555555'
    const memberId = '66666666-6666-4666-8666-666666666666'
    const result = {
      type: 'cash_recharge' as const,
      wallet: {
        operationId: '88888888-8888-4888-8888-888888888888',
        wallet: {
          accountId: '99999999-9999-4999-8999-999999999999',
          memberId,
          principalBalanceFen: 50_000,
          giftBalanceFen: 5_000,
          totalBalanceFen: 55_000,
          status: 'active' as const,
          updatedAt: '2026-06-14T08:00:10.000Z'
        },
        principalDeltaFen: 50_000,
        giftDeltaFen: 5_000
      }
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            commandId,
            requestedBy: '44444444-4444-4444-8444-444444444444',
            request: {
              requestId: commandId,
              type: 'cash_recharge',
              memberId,
              principalFen: 50_000
            },
            leaseExpiresAt: '2026-06-14T08:00:45.000Z',
            expiresAt: '2026-06-14T08:10:00.000Z'
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            commandId,
            requestId: 'mobile-finance-1',
            type: 'cash_recharge',
            status: 'completed',
            requestedBy: '44444444-4444-4444-8444-444444444444',
            claimedByDevice: 'device-1',
            result,
            errorMessage: null,
            createdAt: '2026-06-14T08:00:00.000Z',
            expiresAt: '2026-06-14T08:10:00.000Z',
            completedAt: '2026-06-14T08:00:10.000Z'
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        )
      )

    await claimCloudEmployeeFinancialCommand(connection, fetchMock)
    await completeCloudEmployeeFinancialCommand(
      connection,
      { commandId, result },
      fetchMock
    )

    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      '/v1/devices/financial-commands/claim'
    )
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      `/v1/devices/financial-commands/${commandId}/complete`
    )
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(
      '"type":"cash_recharge"'
    )
  })
})
