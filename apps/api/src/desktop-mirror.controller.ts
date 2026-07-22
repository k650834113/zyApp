import {
  Controller,
  Body,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from '@nestjs/common'
import {
  DeviceAuthGuard,
  type DeviceRequest
} from './device-auth.guard'
import { DesktopMirrorService } from './desktop-mirror.service'

@UseGuards(DeviceAuthGuard)
@Controller('desktop/mirror')
export class DesktopMirrorController {
  constructor(
    @Inject(DesktopMirrorService)
    private readonly mirrors: DesktopMirrorService
  ) {}

  @Get('epoch/current')
  async currentEpoch(
    @Req() request: DeviceRequest,
    @Res() response: {
      status(code: number): { json(body: unknown): unknown }
    }
  ): Promise<void> {
    if (!request.zyappDevice) {
      throw new Error('Device guard did not attach a principal')
    }
    const epoch = await this.mirrors.currentEpoch(request.zyappDevice)
    response.status(200).json(epoch)
  }

  @Get(':resource')
  page(
    @Req() request: DeviceRequest,
    @Param('resource') resource: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string
  ) {
    if (!request.zyappDevice) {
      throw new Error('Device guard did not attach a principal')
    }
    return this.mirrors.page(request.zyappDevice, resource, after, limit)
  }

  @Post('epoch/empty')
  activateEmptyEpoch(
    @Req() request: DeviceRequest,
    @Body() body: unknown
  ) {
    if (!request.zyappDevice) {
      throw new Error('Device guard did not attach a principal')
    }
    return this.mirrors.activateEmptyEpoch(request.zyappDevice, body)
  }
}
