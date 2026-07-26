import {
  Controller,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  type RawBodyRequest
} from '@nestjs/common'
import {
  WECHAT_PAYMENT_PROVIDER
} from './infrastructure.module'
import { MemberRechargeService } from './member-recharge.service'
import { MemberMonthlyCardService } from './member-monthly-card.service'
import type { WechatPaymentProvider } from './wechat-payment-provider'

type NotificationRequest = {
  headers: Record<string, string | string[] | undefined>
}

@Controller('payments/wechat/recharge')
export class WechatPaymentController {
  constructor(
    @Inject(WECHAT_PAYMENT_PROVIDER)
    private readonly provider: WechatPaymentProvider,
    @Inject(MemberRechargeService)
    private readonly recharges: MemberRechargeService,
    @Inject(MemberMonthlyCardService)
    private readonly monthlyCards: MemberMonthlyCardService
  ) {}

  @Post('notify')
  @HttpCode(204)
  async notify(
    @Req() request: RawBodyRequest<NotificationRequest>
  ): Promise<void> {
    try {
      if (!request.rawBody) throw new Error('raw body is unavailable')
      const notification = this.provider.verifyNotification({
        headers: request.headers,
        rawBody: request.rawBody.toString('utf8')
      })
      const handled = await this.monthlyCards.handleWechatNotification(
        notification
      )
      if (!handled) {
        await this.recharges.handleWechatNotification(notification)
      }
    } catch {
      throw new HttpException(
        { code: 'FAIL', message: 'invalid notification' },
        400
      )
    }
  }
}
