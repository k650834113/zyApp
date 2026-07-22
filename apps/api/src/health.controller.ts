import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException
} from '@nestjs/common'
import { InfrastructureHealthService } from './infrastructure.module'

@Controller('health')
export class HealthController {
  constructor(
    @Inject(InfrastructureHealthService)
    private readonly infrastructureHealth: InfrastructureHealthService
  ) {}

  @Get('live')
  live(): { status: 'ok'; service: 'zyapp-api'; timestamp: string } {
    return {
      status: 'ok',
      service: 'zyapp-api',
      timestamp: new Date().toISOString()
    }
  }

  @Get('ready')
  async ready(): Promise<{
    status: 'ok'
    service: 'zyapp-api'
    postgres: { ok: true; version: string; databaseTime: string }
    redis: { ok: true; response: string }
  }> {
    try {
      const health = await this.infrastructureHealth.check()
      return {
        status: 'ok',
        service: 'zyapp-api',
        ...health
      }
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        service: 'zyapp-api',
        reason: error instanceof Error ? error.message : 'unknown error'
      })
    }
  }
}
