import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable
} from '@nestjs/common'
import {
  extractBearerToken,
  type MiniappPrincipal
} from './miniapp-auth'
import { MiniappSessionService } from './miniapp-session.service'

export type MiniappRequest = {
  headers: Record<string, string | string[] | undefined>
  zyappMiniapp?: MiniappPrincipal
}

@Injectable()
export class MiniappAuthGuard implements CanActivate {
  constructor(
    @Inject(MiniappSessionService)
    private readonly sessions: MiniappSessionService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MiniappRequest>()
    request.zyappMiniapp = await this.sessions.authenticate(
      extractBearerToken(request.headers.authorization)
    )
    return true
  }
}
