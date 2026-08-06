import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common'
import type {
  BoardGameMetadataAvailability,
  BoardGameMetadataCandidate,
  BoardGameMetadataDetails
} from '@zyapp/contracts'
import type { Pool } from '@zyapp/cloud-db'
import { createHash } from 'node:crypto'
import type { DevicePrincipal } from '../device-auth'
import { POSTGRES_POOL } from '../infrastructure.module'
import {
  BOARD_GAME_METADATA_ADAPTER,
  type BoardGameMetadataAdapter,
  BggMetadataError
} from './bgg-adapter'
import { BggRequestGate } from './request-gate'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function actorId(value: string): string {
  const normalized = value?.trim().toLowerCase()
  if (!UUID_PATTERN.test(normalized)) {
    throw new BadRequestException('actorId must be a UUID')
  }
  return normalized
}

function normalizedQuery(value: string): string {
  const normalized = value?.trim().replace(/\s+/g, ' ')
  if (!normalized || normalized.length > 120) {
    throw new BadRequestException('query must contain 1 to 120 characters')
  }
  return normalized
}

function externalId(value: string): string {
  const normalized = value?.trim()
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new BadRequestException('externalId must be a positive integer')
  }
  return normalized
}

@Injectable()
export class BoardGameMetadataService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(BggRequestGate) private readonly gate: BggRequestGate,
    @Inject(BOARD_GAME_METADATA_ADAPTER)
    private readonly adapter: BoardGameMetadataAdapter
  ) {}

  async status(
    principal: DevicePrincipal,
    actorIdValue: string
  ): Promise<BoardGameMetadataAvailability> {
    await this.requireManager(principal, actorId(actorIdValue))
    return {
      source: this.adapter.source,
      enabled: this.adapter.enabled,
      imagesEnabled: this.adapter.imagesEnabled
    }
  }

  async search(
    principal: DevicePrincipal,
    actorIdValue: string,
    queryValue: string
  ): Promise<BoardGameMetadataCandidate[]> {
    await this.requireManager(principal, actorId(actorIdValue))
    this.requireEnabled()
    const query = normalizedQuery(queryValue)
    const digest = createHash('sha256')
      .update(query.toLocaleLowerCase('zh-CN'))
      .digest('hex')
    try {
      const candidates = await this.gate.cached(
        `zyapp:bgg:search:${digest}`,
        86_400,
        () => this.adapter.search(query)
      )
      return candidates.slice(0, 20)
    } catch (error) {
      this.throwStableError(error)
    }
  }

  async details(
    principal: DevicePrincipal,
    actorIdValue: string,
    externalIdValue: string
  ): Promise<BoardGameMetadataDetails> {
    await this.requireManager(principal, actorId(actorIdValue))
    this.requireEnabled()
    const id = externalId(externalIdValue)
    try {
      return await this.gate.cached(
        `zyapp:bgg:details:${id}`,
        604_800,
        () => this.adapter.details(id)
      )
    } catch (error) {
      this.throwStableError(error)
    }
  }

  private requireEnabled(): void {
    if (!this.adapter.enabled) {
      throw new ServiceUnavailableException(
        'BGG metadata integration is disabled'
      )
    }
  }

  private async requireManager(
    principal: DevicePrincipal,
    employeeId: string
  ): Promise<void> {
    const result = await this.pool.query(
      `SELECT employee.id
       FROM cloud_employee employee
       JOIN cloud_employee_store_access access
         ON access.tenant_id = employee.tenant_id
        AND access.employee_id = employee.id
        AND access.store_id = $3
       WHERE employee.id = $1
         AND employee.tenant_id = $2
         AND employee.status = 'active'
         AND access.status = 'active'
         AND access.role = 'manager'
       LIMIT 1`,
      [employeeId, principal.tenantId, principal.storeId]
    )
    if (!result.rows[0]) {
      throw new ForbiddenException('Manager access is required')
    }
  }

  private throwStableError(error: unknown): never {
    if (error instanceof BggMetadataError) {
      if (error.code === 'timeout') {
        throw new GatewayTimeoutException('BGG request timed out')
      }
      if (error.code === 'not_found') {
        throw new NotFoundException('BGG board game was not found')
      }
      if (error.code === 'malformed') {
        throw new BadGatewayException('BGG returned malformed metadata')
      }
      throw new ServiceUnavailableException('BGG metadata is unavailable')
    }
    throw new ServiceUnavailableException(
      'BGG metadata cache or request gate is unavailable'
    )
  }
}
