import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
  UseGuards
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
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
import {
  MemberAvatarService,
  type MemberAvatarUpload
} from './member-avatar.service'

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
    private readonly recharges: MemberRechargeService,
    @Inject(MemberAvatarService)
    private readonly avatars: MemberAvatarService
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

  @Post('profile-with-avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 }
    })
  )
  async updateProfileWithAvatar(
    @Req() request: MiniappRequest,
    @Body() body: unknown,
    @UploadedFile() file?: MemberAvatarUpload
  ): Promise<MemberSelfServiceSummary> {
    if (!file) {
      throw new BadRequestException('Avatar image is required')
    }
    const stored = await this.avatars.store(file)
    return this.members.updateProfileWithAvatar(
      principal(request),
      body,
      stored.publicUrl
    )
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
