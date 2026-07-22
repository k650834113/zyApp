import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common'
import type { DesktopCloudLoginResult } from '@zyapp/contracts'
import { DesktopAuthService } from './desktop-auth.service'
import { DeviceAuthGuard, type DeviceRequest } from './device-auth.guard'

@UseGuards(DeviceAuthGuard)
@Controller('desktop-auth')
export class DesktopAuthController {
  constructor(
    @Inject(DesktopAuthService) private readonly auth: DesktopAuthService
  ) {}

  @Post('login')
  login(
    @Req() request: DeviceRequest,
    @Body() body: unknown
  ): Promise<DesktopCloudLoginResult> {
    if (!request.zyappDevice) {
      throw new Error('Device guard did not attach a principal')
    }
    return this.auth.login(request.zyappDevice, body)
  }
}
