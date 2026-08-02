import type { ExecutionContext } from '@nestjs/common'
import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { MiniappPrincipal } from './miniapp-auth'
import type { MiniappRequest } from './miniapp-auth.guard'
import { MiniappOptionalAuthGuard } from './miniapp-optional-auth.guard'

function context(request: MiniappRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext
}

const principal = {
  identityId: '11111111-1111-4111-8111-111111111111'
} as MiniappPrincipal

describe('optional miniapp authentication', () => {
  it('keeps a request anonymous when no bearer token is present', async () => {
    const authenticate = vi.fn()
    const request: MiniappRequest = { headers: {} }
    const guard = new MiniappOptionalAuthGuard({ authenticate } as never)

    await expect(guard.canActivate(context(request))).resolves.toBe(true)
    expect(authenticate).not.toHaveBeenCalled()
    expect(request.zyappMiniapp).toBeUndefined()
  })

  it('attaches the authenticated viewer when a bearer token is present', async () => {
    const authenticate = vi.fn().mockResolvedValue(principal)
    const request: MiniappRequest = {
      headers: { authorization: 'Bearer valid-token' }
    }
    const guard = new MiniappOptionalAuthGuard({ authenticate } as never)

    await expect(guard.canActivate(context(request))).resolves.toBe(true)
    expect(authenticate).toHaveBeenCalledWith('valid-token')
    expect(request.zyappMiniapp).toBe(principal)
  })

  it('propagates an invalid-token failure so the client can renew', async () => {
    const authenticate = vi
      .fn()
      .mockRejectedValue(new UnauthorizedException('invalid'))
    const guard = new MiniappOptionalAuthGuard({ authenticate } as never)

    await expect(
      guard.canActivate(
        context({ headers: { authorization: 'Bearer expired-token' } })
      )
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
