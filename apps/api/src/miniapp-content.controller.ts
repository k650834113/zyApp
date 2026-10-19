import { Optional, Body, ConflictException, Controller, Get, Inject, Post, Query, Req, UnauthorizedException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { DeviceAuthGuard, type DeviceRequest } from './device-auth.guard'
import type { BoardGameCoverUpload } from './board-game-cover-cache.service'
import { MiniappContentService } from './miniapp-content.service'
import { PublicContentService } from './public-content.service'
import { MemberMonthlyCardService } from './member-monthly-card.service'

import { MapLocationService } from './map-location.service'

function principal(request: DeviceRequest) {
  if (!request.zyappDevice) throw new UnauthorizedException('Device authentication is required')
  return request.zyappDevice
}
@UseGuards(DeviceAuthGuard)
@Controller('miniapp-content')
export class MiniappContentController {
  constructor(
    @Inject(MiniappContentService) private readonly service: MiniappContentService,
    @Inject(PublicContentService) private readonly publicContent: PublicContentService,
    @Inject(MemberMonthlyCardService) private readonly monthlyCards: MemberMonthlyCardService,
    @Optional() @Inject(MapLocationService) private readonly maps: MapLocationService = new MapLocationService()
  ) {}
  @Get()
  async read(@Req() request: DeviceRequest, @Query('actorId') actorId: string) {
    const device = principal(request)
    const workspace = await this.service.read(device, actorId)
    const [home, rows, monthlyCard] = await Promise.all([
      this.publicContent.getHome(device.storeId),
      this.publicContent.getPricingRows(device.storeId),
      this.monthlyCards.getPublicPlan(device.storeId)
    ])
    if ((home.content?.revision ?? null) !== (workspace.published?.revision ?? null)) {
      throw new ConflictException('小程序内容在读取期间发生变化，请重新读取')
    }
    return { ...workspace, current: { home, pricing: { rows, monthlyCard }, readAt: new Date().toISOString() } }
  }
  @Post('location-search')
  async searchLocation(@Req() request: DeviceRequest, @Query('actorId') actorId: string, @Body() body: unknown) {
    await this.service.read(principal(request), actorId)
    return this.maps.search(body)
  }
  @Get('history')
  history(@Req() request: DeviceRequest, @Query('actorId') actorId: string) {
    return this.service.history(principal(request), actorId)
  }
  @Post('commands')
  execute(@Req() request: DeviceRequest, @Query('actorId') actorId: string, @Body() body: unknown) {
    return this.service.execute(principal(request), actorId, body)
  }
  @Post('media')
  @UseInterceptors(FileInterceptor('image', { limits: {fileSize: 10 * 1024 * 1024, files: 1} }))
  upload(@Req() request: DeviceRequest, @Query('actorId') actorId: string, @UploadedFile() file?: BoardGameCoverUpload) {
    return this.service.upload(principal(request), actorId, file)
  }
}
