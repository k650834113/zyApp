import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable
} from '@nestjs/common'
import { extractBearerToken } from './miniapp-auth'
import type { MiniappRequest } from './miniapp-auth.guard'
import { MiniappSessionService } from './miniapp-session.service'

@Injectable()
export class MiniappOptionalAuthGuard implements CanActivate {
  constructor(
    @Inject(MiniappSessionService)
    private readonly sessions: MiniappSessionService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MiniappRequest>()
    const token = extractBearerToken(request.headers.authorization)
    if (!token) return true
    request.zyappMiniapp = await this.sessions.authenticate(token)
    return true
  }
}
