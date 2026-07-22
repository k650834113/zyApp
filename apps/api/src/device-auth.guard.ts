import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable
} from '@nestjs/common'
import type { DevicePrincipal } from './device-auth'
import { DeviceService } from './device.service'

export type DeviceRequest = {
  headers: Record<string, string | string[] | undefined>
  zyappDevice?: DevicePrincipal
}

function firstHeader(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(
    @Inject(DeviceService) private readonly deviceService: DeviceService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeviceRequest>()
    const authorization = firstHeader(request.headers.authorization)
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : undefined
    const deviceId = firstHeader(request.headers['x-zyapp-device-id'])
    request.zyappDevice = await this.deviceService.authenticate(deviceId, token)
    return true
  }
}
