import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards
} from '@nestjs/common'
import type {
  MiniappIdentity,
  MiniappSessionResult
} from '@zyapp/contracts'
import {
  MiniappAuthGuard,
  type MiniappRequest
} from './miniapp-auth.guard'
import { MiniappSessionService } from './miniapp-session.service'
import { extractBearerToken } from './miniapp-auth'

@Controller('miniapp')
export class MiniappController {
  @Post('logout')
  async logout(@Req() request:MiniappRequest):Promise<void> {
    const token=extractBearerToken(request.headers.authorization)
    if (token) await this.sessions.logout(token)
  }
  constructor(
    @Inject(MiniappSessionService)
    private readonly sessions: MiniappSessionService
  ) {}

  @Post('development-session')
  developmentSession(@Body() body: unknown): Promise<MiniappSessionResult> {
    return this.sessions.createDevelopmentSession(body)
  }

  @Post('wechat-session')
  wechatSession(@Body() body: unknown): Promise<MiniappSessionResult> {
    return this.sessions.createWechatSession(body)
  }

  @UseGuards(MiniappAuthGuard)
  @Get('session')
  session(@Req() request: MiniappRequest): MiniappIdentity {
    if (!request.zyappMiniapp) {
      throw new Error('Miniapp guard did not attach a principal')
    }
    return request.zyappMiniapp.identity
  }
}
