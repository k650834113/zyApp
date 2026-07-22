import { describe, expect, it, vi } from 'vitest'
import { DesktopMirrorController } from './desktop-mirror.controller'
import type { DesktopMirrorService } from './desktop-mirror.service'

describe('desktop mirror controller', () => {
  it('writes an explicit JSON null when the store has no cloud epoch', async () => {
    const mirrors = {
      currentEpoch: vi.fn(async () => null)
    } as unknown as DesktopMirrorService
    const json = vi.fn()
    const status = vi.fn(() => ({ json }))
    const controller = new DesktopMirrorController(mirrors)

    await controller.currentEpoch(
      {
        zyappDevice: {
          tenantId: '11111111-1111-4111-8111-111111111111',
          storeId: '22222222-2222-4222-8222-222222222222',
          deviceId: '33333333-3333-4333-8333-333333333333',
          deviceName: 'Cashier'
        }
      } as never,
      { status }
    )

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith(null)
  })
})
