import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards
} from '@nestjs/common'
import type {
  MemberSelfServiceSummary,
  MemberSelfServiceHistory,
  PhoneVerificationChallenge
} from '@zyapp/contracts'
import {
  MiniappAuthGuard,
  type MiniappRequest
} from './miniapp-auth.guard'
import { MemberSelfService } from './member-self-service.service'
import { MemberRechargeService } from './member-recharge.service'

function principal(request: MiniappRequest) {
  if (!request.zyappMiniapp) {
    throw new Error('Miniapp guard did not attach a principal')
  }
  return request.zyappMiniapp
}

@UseGuards(MiniappAuthGuard)
@Controller('member')
export class MemberSelfServiceController {
  constructor(
    @Inject(MemberSelfService)
    private readonly members: MemberSelfService,
    @Inject(MemberRechargeService)
    private readonly recharges: MemberRechargeService
  ) {}

  @Post('verification/request')
  requestVerification(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<PhoneVerificationChallenge> {
    return this.members.requestPhoneVerification(principal(request), body)
  }

  @Post('register')
  register(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<MemberSelfServiceSummary> {
    return this.members.registerMember(principal(request), body)
  }

  @Post('wechat-one-tap-login')
  loginWithWechatProfile(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<MemberSelfServiceSummary> {
    return this.members.loginWithWechatProfile(principal(request), body)
  }

  @Get('self')
  self(
    @Req() request: MiniappRequest
  ): Promise<MemberSelfServiceSummary | null> {
    return this.members.getSelf(principal(request))
  }

  @Post('profile')
  updateProfile(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<MemberSelfServiceSummary> {
    return this.members.updateProfile(principal(request), body)
  }

  @Post('birthday')
  birthday(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ): Promise<MemberSelfServiceSummary> {
    return this.members.fillBirthday(principal(request), body)
  }

  @Get('history')
  history(
    @Req() request: MiniappRequest
  ): Promise<MemberSelfServiceHistory> {
    return this.members.getHistory(principal(request))
  }

  @Post('recharge-orders')
  createRechargeOrder(
    @Req() request: MiniappRequest,
    @Body() body: unknown
  ) {
    return this.recharges.createOrder(principal(request), body)
  }

  @Get('recharge-configuration')
  rechargeConfiguration(@Req() request: MiniappRequest) {
    return this.recharges.getConfiguration(principal(request))
  }

  @Get('recharge-orders/:orderId')
  getRechargeOrder(
    @Req() request: MiniappRequest,
    @Param('orderId') orderId: string
  ) {
    return this.recharges.getOrder(principal(request), orderId)
  }

  @Post('recharge-orders/:orderId/mock-settle')
  settleMockRechargeOrder(
    @Req() request: MiniappRequest,
    @Param('orderId') orderId: string
  ) {
    return this.recharges.settleMockOrder(principal(request), orderId)
  }
}
