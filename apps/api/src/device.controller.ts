import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  UseGuards
} from '@nestjs/common'
import type {
  CashierCommandExecution,
  CashierCommandSummary,
  EmployeeFinancialCommandExecution,
  EmployeeFinancialCommandSummary,
  RenewCashierCommandResult
} from '@zyapp/contracts'
import { CashierCommandService } from './cashier-command.service'
import { EmployeeFinancialCommandService } from './employee-financial-command.service'
import type { DevicePrincipal } from './device-auth'
import {
  DeviceAuthGuard,
  type DeviceRequest
} from './device-auth.guard'
import { DeviceService } from './device.service'

@Controller('devices')
export class DeviceController {
  constructor(
    @Inject(DeviceService) private readonly deviceService: DeviceService,
    @Inject(CashierCommandService)
    private readonly cashierCommands: CashierCommandService,
    @Inject(EmployeeFinancialCommandService)
    private readonly financialCommands: EmployeeFinancialCommandService
  ) {}

  @Post('enroll')
  enroll(
    @Body() body: unknown,
    @Headers('x-zyapp-enrollment-secret') enrollmentSecret?: string
  ): Promise<DevicePrincipal & { token: string }> {
    return this.deviceService.enroll(body, enrollmentSecret)
  }

  @Post('registration-codes')
  createRegistrationCode(
    @Body() body: unknown,
    @Headers('x-zyapp-enrollment-secret') enrollmentSecret?: string
  ) {
    return this.deviceService.createRegistrationCode(body, enrollmentSecret)
  }

  @Post('enroll-paired')
  enrollPaired(@Body() body: unknown) {
    return this.deviceService.enrollPaired(body)
  }

  @Post('enroll-authorized-store')
  enrollAuthorizedStore(@Body() body: unknown) {
    return this.deviceService.enrollAuthorizedStore(body)
  }

  @UseGuards(DeviceAuthGuard)
  @Post('pairing-codes')
  createPairingCode(
    @Req() request: DeviceRequest,
    @Body() body: unknown
  ) {
    return this.deviceService.createPairingCode(principal(request), body)
  }

  @UseGuards(DeviceAuthGuard)
  @Get('me')
  me(@Req() request: DeviceRequest): DevicePrincipal {
    if (!request.zyappDevice) {
      throw new Error('Device guard did not attach a principal')
    }
    return request.zyappDevice
  }

  @UseGuards(DeviceAuthGuard)
  @Get('offline-writer-lease')
  offlineWriterLease(
    @Req() request: DeviceRequest
  ) {
    return this.deviceService.getOfflineFinancialLease(principal(request))
  }

  @UseGuards(DeviceAuthGuard)
  @Post('offline-writer-lease/claim')
  claimOfflineWriterLease(
    @Req() request: DeviceRequest,
    @Body() body: unknown
  ) {
    return this.deviceService.claimOfflineFinancialLease(
      principal(request),
      body
    )
  }

  @UseGuards(DeviceAuthGuard)
  @Post('offline-writer-lease/renew')
  renewOfflineWriterLease(
    @Req() request: DeviceRequest
  ) {
    return this.deviceService.renewOfflineFinancialLease(principal(request))
  }

  @UseGuards(DeviceAuthGuard)
  @Post('cashier-commands/claim')
  claimCashierCommand(
    @Req() request: DeviceRequest
  ): Promise<CashierCommandExecution | null> {
    return this.cashierCommands.claim(principal(request))
  }

  @UseGuards(DeviceAuthGuard)
  @Post('cashier-commands/:commandId/renew')
  renewCashierCommand(
    @Req() request: DeviceRequest,
    @Param('commandId') commandId: string
  ): Promise<RenewCashierCommandResult> {
    return this.cashierCommands.renew(principal(request), commandId)
  }

  @UseGuards(DeviceAuthGuard)
  @Post('cashier-commands/:commandId/complete')
  completeCashierCommand(
    @Req() request: DeviceRequest,
    @Param('commandId') commandId: string,
    @Body() body: unknown
  ): Promise<CashierCommandSummary> {
    return this.cashierCommands.complete(
      principal(request),
      commandId,
      body
    )
  }

  @UseGuards(DeviceAuthGuard)
  @Post('cashier-commands/:commandId/fail')
  failCashierCommand(
    @Req() request: DeviceRequest,
    @Param('commandId') commandId: string,
    @Body() body: unknown
  ): Promise<CashierCommandSummary> {
    return this.cashierCommands.fail(principal(request), commandId, body)
  }

  @UseGuards(DeviceAuthGuard)
  @Post('financial-commands/claim')
  claimFinancialCommand(
    @Req() request: DeviceRequest
  ): Promise<EmployeeFinancialCommandExecution | null> {
    return this.financialCommands.claim(principal(request))
  }

  @UseGuards(DeviceAuthGuard)
  @Post('financial-commands/:commandId/renew')
  renewFinancialCommand(
    @Req() request: DeviceRequest,
    @Param('commandId') commandId: string
  ): Promise<RenewCashierCommandResult> {
    return this.financialCommands.renew(principal(request), commandId)
  }

  @UseGuards(DeviceAuthGuard)
  @Post('financial-commands/:commandId/complete')
  completeFinancialCommand(
    @Req() request: DeviceRequest,
    @Param('commandId') commandId: string,
    @Body() body: unknown
  ): Promise<EmployeeFinancialCommandSummary> {
    return this.financialCommands.complete(
      principal(request),
      commandId,
      body
    )
  }

  @UseGuards(DeviceAuthGuard)
  @Post('financial-commands/:commandId/fail')
  failFinancialCommand(
    @Req() request: DeviceRequest,
    @Param('commandId') commandId: string,
    @Body() body: unknown
  ): Promise<EmployeeFinancialCommandSummary> {
    return this.financialCommands.fail(
      principal(request),
      commandId,
      body
    )
  }
}

function principal(request: DeviceRequest): DevicePrincipal {
  if (!request.zyappDevice) {
    throw new Error('Device guard did not attach a principal')
  }
  return request.zyappDevice
}
