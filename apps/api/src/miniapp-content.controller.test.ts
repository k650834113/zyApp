import { describe, expect, it, vi } from 'vitest'
import { MiniappContentController } from './miniapp-content.controller'
import type { MiniappContentService } from './miniapp-content.service'
import type { PublicContentService } from './public-content.service'
import type { MemberMonthlyCardService } from './member-monthly-card.service'
import type { DeviceRequest } from './device-auth.guard'
import type { MapLocationService } from './map-location.service'

function fixture() {
  const service = {read:vi.fn().mockResolvedValue({revision:null,draft:null,published:null})}
  const publicContent = {getHome:vi.fn().mockResolvedValue({content:null}),getPricingRows:vi.fn().mockResolvedValue([])}
  const monthlyCards = {getPublicPlan:vi.fn().mockResolvedValue({priceFen:20000,durationDays:30})}
  const controller = new MiniappContentController(service as unknown as MiniappContentService,publicContent as unknown as PublicContentService,monthlyCards as unknown as MemberMonthlyCardService)
  const request = {zyappDevice:{tenantId:'tenant',storeId:'bound-store',deviceId:'device',deviceName:'PC'}} as DeviceRequest
  return {service,publicContent,monthlyCards,controller,request}
}
describe('current miniapp content read', () => {
  it('checks store manager access before map search and only returns candidates', async () => {
    const f = fixture()
    const maps = {search:vi.fn().mockResolvedValue([])}
    const controller = new MiniappContentController(f.service as unknown as MiniappContentService, f.publicContent as unknown as PublicContentService, f.monthlyCards as unknown as MemberMonthlyCardService, maps as unknown as MapLocationService)
    const query = {name:'据点桌游',city:'襄阳市',address:'谷山大厦A座'}
    await controller.searchLocation(f.request,'manager',query)
    expect(f.service.read).toHaveBeenCalledWith(f.request.zyappDevice,'manager')
    expect(maps.search).toHaveBeenCalledWith(query)
    maps.search.mockClear()
    f.service.read.mockRejectedValue(new Error('Manager access is required'))
    await expect(controller.searchLocation(f.request,'staff',query)).rejects.toThrow('Manager')
    expect(maps.search).not.toHaveBeenCalled()
  })
  it('uses the authenticated device store and the same public services as the miniapp', async () => {
    const f = fixture()
    const result = await f.controller.read(f.request,'manager')
    expect(f.service.read).toHaveBeenCalledWith(f.request.zyappDevice,'manager')
    expect(f.publicContent.getHome).toHaveBeenCalledWith('bound-store')
    expect(f.publicContent.getPricingRows).toHaveBeenCalledWith('bound-store')
    expect(f.monthlyCards.getPublicPlan).toHaveBeenCalledWith('bound-store')
    expect(result.current.pricing.monthlyCard.priceFen).toBe(20000)
    expect(Number.isFinite(Date.parse(result.current.readAt))).toBe(true)
  })
  it('checks manager access before reading public snapshots', async () => {
    const f = fixture()
    f.service.read.mockRejectedValue(new Error('Manager access is required'))
    await expect(f.controller.read(f.request,'staff')).rejects.toThrow('Manager')
    expect(f.publicContent.getHome).not.toHaveBeenCalled()
  })
  it('rejects content changed during the read instead of merging different publications', async () => {
    const f = fixture()
    f.publicContent.getHome.mockResolvedValue({content:{revision:'changed'}})
    await expect(f.controller.read(f.request,'manager')).rejects.toThrow('读取期间发生变化')
  })
})
