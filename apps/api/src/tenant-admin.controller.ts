import { Body, Controller, Get, Inject, Post, Query, Req, UseGuards } from '@nestjs/common'
import { DeviceAuthGuard, type DeviceRequest } from './device-auth.guard'
import type { DevicePrincipal } from './device-auth'
import { TenantAdminService } from './tenant-admin.service'

function principal(request: DeviceRequest): DevicePrincipal {
  if (!request.zyappDevice) throw new Error('Device guard did not attach a principal')
  return request.zyappDevice
}

@UseGuards(DeviceAuthGuard)
@Controller('tenant-admin')
export class TenantAdminController {
  constructor(
    @Inject(TenantAdminService) private readonly service: TenantAdminService
  ) {}

  @Get('stores')
  stores(@Req() request: DeviceRequest, @Query('actorId') actorId: string) {
    return this.service.listStores(principal(request), actorId)
  }

  @Post('stores')
  createStore(@Req() request: DeviceRequest, @Query('actorId') actorId: string,
    @Body() body: unknown) {
    return this.service.createStore(principal(request), actorId, body)
  }

  @Get('employee-store-access')
  employeeStoreAccess(
    @Req() request: DeviceRequest,
    @Query('actorId') actorId: string
  ) {
    return this.service.listEmployeeAccess(principal(request), actorId)
  }

  @Post('employee-store-access')
  setEmployeeStoreAccess(
    @Req() request: DeviceRequest,
    @Query('actorId') actorId: string,
    @Body() body: unknown
  ) {
    return this.service.setEmployeeAccess(principal(request), actorId, body)
  }

  @Get('business-templates')
  businessTemplates(@Req() request: DeviceRequest, @Query('actorId') actorId: string) {
    return this.service.listBusinessTemplates(principal(request), actorId)
  }

  @Post('business-templates')
  saveBusinessTemplate(
    @Req() request: DeviceRequest,
    @Query('actorId') actorId: string,
    @Body() body: unknown
  ) {
    return this.service.saveBusinessTemplate(principal(request), actorId, body)
  }

  @Post('business-template-overrides')
  saveBusinessTemplateOverride(
    @Req() request: DeviceRequest,
    @Query('actorId') actorId: string,
    @Body() body: unknown
  ) {
    return this.service.saveBusinessTemplateOverride(principal(request), actorId, body)
  }
}
