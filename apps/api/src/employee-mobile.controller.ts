import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common'
import type {
  AnnouncementSummary,
  BoardGameSummary,
  CashierCommandSummary,
  CatalogItemSummary,
  EmployeeFinancialCommandSummary,
  EmployeeMobileMemberSummary,
  ActivitySummary,
  BusinessReport,
  MiniappIdentity,
  StoreProfileSummary
} from '@zyapp/contracts'
import { CashierCommandService } from './cashier-command.service'
import {
  MiniappAuthGuard,
  type MiniappRequest
} from './miniapp-auth.guard'
import { EmployeeMobileService } from './employee-mobile.service'
import { EmployeeFinancialCommandService } from './employee-financial-command.service'
import { EmployeeManagerService } from './employee-manager.service'
import { EmployeeContentService } from './employee-content.service'

function principal(request: MiniappRequest) {
  if (!request.zyappMiniapp) {
    throw new Error('Miniapp guard did not attach a principal')
  }
  return request.zyappMiniapp
}

@UseGuards(MiniappAuthGuard)
@Controller('employee')
export class EmployeeMobileController {
  constructor(
    @Inject(EmployeeMobileService)
    private readonly employees: EmployeeMobileService,
    @Inject(CashierCommandService)
    private readonly cashierCommands: CashierCommandService,
    @Inject(EmployeeFinancialCommandService)
    private readonly financialCommands: EmployeeFinancialCommandService,
    @Inject(EmployeeManagerService)
    private readonly manager: EmployeeManagerService,
    @Inject(EmployeeContentService)
    private readonly content: EmployeeContentService
  ) {}

  @Post('mobile-login')
  login(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<MiniappIdentity> {
    return this.employees.login(principal(request), body)
  }

  @Post('mobile-logout')
  logout(@Req() request: MiniappRequest): Promise<void> {
    return this.employees.logout(principal(request))
  }

  @Get('members')
  members(
    @Req() request: MiniappRequest,
    @Query('query') query?: string,
    @Query('limit') limit?: string
  ): Promise<EmployeeMobileMemberSummary[]> {
    return this.employees.searchMembers(
      principal(request),
      query ?? '',
      limit
    )
  }

  @Get('members/:memberId')
  member(
    @Req() request: MiniappRequest,
    @Param('memberId') memberId: string
  ): Promise<EmployeeMobileMemberSummary> {
    return this.employees.getMember(principal(request), memberId)
  }

  @Post('members')
  createMember(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<EmployeeMobileMemberSummary> {
    return this.employees.createMember(principal(request), body)
  }

  @Get('cashier-catalog')
  cashierCatalog(
    @Req() request: MiniappRequest
  ): Promise<CatalogItemSummary[]> {
    return this.cashierCommands.listCatalog(principal(request))
  }

  @Post('cashier-commands')
  createCashierCommand(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<CashierCommandSummary> {
    return this.cashierCommands.create(principal(request), body)
  }

  @Get('cashier-commands/:commandId')
  cashierCommand(
    @Req() request: MiniappRequest,
    @Param('commandId') commandId: string
  ): Promise<CashierCommandSummary> {
    return this.cashierCommands.get(principal(request), commandId)
  }

  @Post('cashier-commands/:commandId/cancel')
  cancelCashierCommand(
    @Req() request: MiniappRequest,
    @Param('commandId') commandId: string
  ): Promise<CashierCommandSummary> {
    return this.cashierCommands.cancel(principal(request), commandId)
  }

  @Post('financial-commands')
  createFinancialCommand(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<EmployeeFinancialCommandSummary> {
    return this.financialCommands.create(principal(request), body)
  }

  @Get('financial-commands/:commandId')
  financialCommand(
    @Req() request: MiniappRequest,
    @Param('commandId') commandId: string
  ): Promise<EmployeeFinancialCommandSummary> {
    return this.financialCommands.get(principal(request), commandId)
  }

  @Post('financial-commands/:commandId/cancel')
  cancelFinancialCommand(
    @Req() request: MiniappRequest,
    @Param('commandId') commandId: string
  ): Promise<EmployeeFinancialCommandSummary> {
    return this.financialCommands.cancel(principal(request), commandId)
  }

  @Get('activities')
  activities(
    @Req() request: MiniappRequest
  ): Promise<ActivitySummary[]> {
    return this.manager.listActivities(principal(request))
  }

  @Post('activities')
  createActivity(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<ActivitySummary> {
    return this.manager.createActivity(principal(request), body)
  }

  @Post('activities/update')
  updateActivity(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<ActivitySummary> {
    return this.manager.updateActivity(principal(request), body)
  }

  @Post('activities/status')
  setActivityStatus(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<ActivitySummary> {
    return this.manager.setActivityStatus(principal(request), body)
  }

  @Get('business-report')
  businessReport(
    @Req() request: MiniappRequest,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string
  ): Promise<BusinessReport> {
    return this.manager.getBusinessReport(principal(request), {
      fromDate,
      toDate
    })
  }

  @Get('announcements')
  announcements(
    @Req() request: MiniappRequest
  ): Promise<AnnouncementSummary[]> {
    return this.content.listAnnouncements(principal(request))
  }

  @Post('announcements')
  createAnnouncement(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<AnnouncementSummary> {
    return this.content.createAnnouncement(principal(request), body)
  }

  @Post('announcements/update')
  updateAnnouncement(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<AnnouncementSummary> {
    return this.content.updateAnnouncement(principal(request), body)
  }

  @Post('announcements/status')
  setAnnouncementStatus(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<AnnouncementSummary> {
    return this.content.setAnnouncementStatus(principal(request), body)
  }

  @Get('board-games')
  boardGames(
    @Req() request: MiniappRequest
  ): Promise<BoardGameSummary[]> {
    return this.content.listBoardGames(principal(request))
  }

  @Post('board-games/operations')
  updateBoardGameOperations(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<BoardGameSummary> {
    return this.content.updateBoardGameOperations(principal(request), body)
  }

  @Get('store-status')
  storeStatus(
    @Req() request: MiniappRequest
  ): Promise<StoreProfileSummary> {
    return this.content.getStoreProfile(principal(request))
  }

  @Post('store-status')
  updateStoreStatus(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<StoreProfileSummary> {
    return this.content.updateStoreStatus(principal(request), body)
  }
}
