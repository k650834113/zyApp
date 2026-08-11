import { describe, expect, it, vi } from 'vitest'
import type { DeviceRequest } from '../device-auth.guard'
import { BoardGameMetadataController } from './board-game-metadata.controller'
import type { BoardGameMetadataService } from './board-game-metadata.service'

const device = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  storeId: '22222222-2222-4222-8222-222222222222',
  deviceId: '33333333-3333-4333-8333-333333333333',
  deviceName: 'Cashier'
}

describe('board-game metadata controller', () => {
  it('forwards only authenticated device context and explicit inputs', async () => {
    const service = {
      status: vi.fn(async () => ({ source: 'bgg', enabled: false, imagesEnabled: false })),
      search: vi.fn(async () => []),
      details: vi.fn(async () => ({ externalId: '13' })),
      cacheCover: vi.fn(async () => ({ externalId: '13' }))
    }
    const controller = new BoardGameMetadataController(
      service as unknown as BoardGameMetadataService
    )
    const request = { headers: {}, zyappDevice: device } as DeviceRequest

    await controller.status(request, 'actor-1')
    await controller.search(request, 'actor-1', 'Catan')
    await controller.details(request, 'actor-1', '13')
    await controller.cacheCover(request, 'actor-1', '13')

    expect(service.status).toHaveBeenCalledWith(device, 'actor-1')
    expect(service.search).toHaveBeenCalledWith(device, 'actor-1', 'Catan')
    expect(service.details).toHaveBeenCalledWith(device, 'actor-1', '13')
    expect(service.cacheCover).toHaveBeenCalledWith(device, 'actor-1', '13')
  })

  it('rejects cache requests without an authenticated device', async () => {
    const service = { cacheCover: vi.fn() }
    const controller = new BoardGameMetadataController(
      service as unknown as BoardGameMetadataService
    )

    expect(() => controller.cacheCover(
      { headers: {} } as DeviceRequest,
      'actor-1',
      '13'
    )).toThrow('Device authentication is required')
    expect(service.cacheCover).not.toHaveBeenCalled()
  })
})
