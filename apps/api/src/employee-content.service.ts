import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { PERMISSIONS } from '@zyapp/auth'
import type {
  AnnouncementStatus,
  AnnouncementSummary,
  BoardGameMissingPart,
  BoardGameSummary,
  EmployeeMobileCreateAnnouncementRequest,
  EmployeeMobileSetAnnouncementStatusRequest,
  EmployeeMobileUpdateAnnouncementRequest,
  EmployeeMobileUpdateBoardGameOperationsRequest,
  EmployeeMobileUpdateStoreStatusRequest,
  SaveAnnouncementFields,
  StoreProfileSummary
} from '@zyapp/contracts'
import type { Pool, PoolClient } from '@zyapp/cloud-db'
import { createHash, randomUUID } from 'node:crypto'
import { POSTGRES_POOL } from './infrastructure.module'
import type { MiniappPrincipal } from './miniapp-auth'

type AnnouncementRow = {
  id: string
  title: string
  content: string
  status: AnnouncementStatus
  pinned: boolean
  visible_from: Date | string
  visible_until: Date | string | null
  published_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

type BoardGameRow = {
  id: string
  base_game_id: string | null
  name: string
  introduction: string
  categories_json: unknown
  min_players: number
  max_players: number
  min_minutes: number | null
  max_minutes: number | null
  difficulty: BoardGameSummary['difficulty']
  complexity_rating: number | string | null
  quantity: number
  record_status: BoardGameSummary['recordStatus']
  available: boolean
  customer_consigned: boolean
  missing_pieces: boolean
  private: boolean
  recommended: boolean
  image_url: string | null
  bgg_id: number | string | null
  metadata_source: 'bgg' | null
  metadata_imported_at: Date | string | null
  customer_note: string | null
  internal_note: string | null
  consignor_nickname: string | null
  missing_parts_json: unknown
  created_at: Date | string
  updated_at: Date | string
}

type StoreRow = {
  id: string
  name: string
  address: string | null
  contact_phone: string | null
  business_open_minute: number
  business_close_minute: number
  status_override: StoreProfileSummary['statusOverride']
  custom_status_text: string | null
  updated_at: Date | string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name}格式不正确`)
  }
  return value as Record<string, unknown>
}

function text(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number
): string {
  if (typeof value !== 'string') throw new Error(`${name}不能为空`)
  const normalized = value.trim()
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(`${name}长度应为 ${minimum}-${maximum} 个字符`)
  }
  return normalized
}

function optionalText(
  value: unknown,
  name: string,
  maximum: number
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return text(value, name, 1, maximum)
}

function requestId(value: unknown): string {
  const normalized = text(value, '请求编号', 8, 100)
  if (!REQUEST_ID_PATTERN.test(normalized)) {
    throw new Error('请求编号格式不正确')
  }
  return normalized
}

function uuid(value: unknown, name: string): string {
  const normalized = text(value, name, 36, 36).toLowerCase()
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${name}格式不正确`)
  return normalized
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name}格式不正确`)
  return value
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name}格式不正确`)
  }
  return new Date(value).toISOString()
}

function announcementFields(
  value: Record<string, unknown>
): SaveAnnouncementFields {
  const visibleFrom = timestamp(value.visibleFrom, '开始展示时间')
  const visibleUntil =
    value.visibleUntil === undefined ||
    value.visibleUntil === null ||
    value.visibleUntil === ''
      ? undefined
      : timestamp(value.visibleUntil, '结束展示时间')
  if (
    visibleUntil !== undefined &&
    Date.parse(visibleUntil) <= Date.parse(visibleFrom)
  ) {
    throw new Error('结束展示时间必须晚于开始展示时间')
  }
  return {
    title: text(value.title, '公告标题', 2, 100),
    content: text(value.content, '公告内容', 2, 5000),
    pinned: boolean(value.pinned, '置顶状态'),
    visibleFrom,
    ...(visibleUntil === undefined ? {} : { visibleUntil })
  }
}

function createAnnouncementInput(
  value: unknown
): EmployeeMobileCreateAnnouncementRequest {
  const input = object(value, '公告请求')
  return {
    requestId: requestId(input.requestId),
    ...announcementFields(input)
  }
}

function updateAnnouncementInput(
  value: unknown
): EmployeeMobileUpdateAnnouncementRequest {
  const input = object(value, '公告请求')
  return {
    requestId: requestId(input.requestId),
    announcementId: uuid(input.announcementId, '公告编号'),
    reason: text(input.reason, '修改原因', 2, 200),
    ...announcementFields(input)
  }
}

function announcementStatusInput(
  value: unknown
): EmployeeMobileSetAnnouncementStatusRequest {
  const input = object(value, '公告状态请求')
  if (input.status !== 'published' && input.status !== 'disabled') {
    throw new Error('公告状态只能是发布或停用')
  }
  return {
    requestId: requestId(input.requestId),
    announcementId: uuid(input.announcementId, '公告编号'),
    status: input.status,
    reason: text(input.reason, '操作原因', 2, 200)
  }
}

function boardGameOperationsInput(
  value: unknown
): EmployeeMobileUpdateBoardGameOperationsRequest {
  const input = object(value, '桌游状态请求')
  if (!Array.isArray(input.missingParts)) {
    throw new Error('缺件明细格式不正确')
  }
  const missingParts = input.missingParts.map((rawPart, index) => {
    const part = object(rawPart, `缺件明细 ${index + 1}`)
    if (!Number.isSafeInteger(part.quantity) || Number(part.quantity) <= 0) {
      throw new Error(`缺件明细 ${index + 1} 数量必须是正整数`)
    }
    return {
      name: text(part.name, `缺件明细 ${index + 1} 名称`, 1, 100),
      quantity: Number(part.quantity)
    }
  })
  const customerConsigned = boolean(input.customerConsigned, '顾客寄存状态')
  const missingPieces = boolean(input.missingPieces, '缺件状态')
  const consignorNickname = optionalText(
    input.consignorNickname,
    '寄存人昵称',
    100
  )
  const customerNote = optionalText(
    input.customerNote,
    '顾客可见备注',
    500
  )
  const internalNote = optionalText(
    input.internalNote,
    '内部备注',
    1000
  )
  if (customerConsigned && !consignorNickname) {
    throw new Error('顾客寄存桌游必须填写寄存人昵称')
  }
  if (missingPieces && missingParts.length === 0) {
    throw new Error('缺件桌游必须填写缺件名称和数量')
  }
  return {
    requestId: requestId(input.requestId),
    boardGameId: uuid(input.boardGameId, '桌游编号'),
    available: boolean(input.available, '可用状态'),
    customerConsigned,
    missingPieces,
    private: boolean(input.private, '不公开状态'),
    ...(customerNote === undefined ? {} : { customerNote }),
    ...(internalNote === undefined ? {} : { internalNote }),
    ...(consignorNickname === undefined ? {} : { consignorNickname }),
    missingParts: missingPieces ? missingParts : [],
    reason: text(input.reason, '修改原因', 2, 200)
  }
}

function storeStatusInput(
  value: unknown
): EmployeeMobileUpdateStoreStatusRequest {
  const input = object(value, '营业状态请求')
  if (
    input.statusOverride !== 'automatic' &&
    input.statusOverride !== 'open' &&
    input.statusOverride !== 'closed'
  ) {
    throw new Error('营业状态格式不正确')
  }
  const customStatusText = optionalText(
    input.customStatusText,
    '自定义状态文字',
    100
  )
  return {
    requestId: requestId(input.requestId),
    statusOverride: input.statusOverride,
    ...(customStatusText === undefined ? {} : { customStatusText }),
    reason: text(input.reason, '修改原因', 2, 200)
  }
}

function announcementVisibility(
  status: AnnouncementStatus,
  visibleFrom: string,
  visibleUntil: string | null,
  now = new Date()
): AnnouncementSummary['visibility'] {
  if (status === 'draft') return 'draft'
  if (status === 'disabled') return 'disabled'
  const current = now.getTime()
  if (current < Date.parse(visibleFrom)) return 'scheduled'
  if (visibleUntil && current >= Date.parse(visibleUntil)) return 'ended'
  return 'active'
}

function announcementSummary(
  row: AnnouncementRow,
  now = new Date()
): AnnouncementSummary {
  const visibleFrom = new Date(row.visible_from).toISOString()
  const visibleUntil =
    row.visible_until === null
      ? null
      : new Date(row.visible_until).toISOString()
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    visibility: announcementVisibility(
      row.status,
      visibleFrom,
      visibleUntil,
      now
    ),
    pinned: row.pinned,
    visibleFrom,
    visibleUntil,
    publishedAt:
      row.published_at === null
        ? null
        : new Date(row.published_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${name}数据损坏`)
  }
  return value
}

function missingParts(value: unknown): BoardGameMissingPart[] {
  if (!Array.isArray(value)) throw new Error('桌游缺件明细数据损坏')
  return value.map((rawPart, index) => {
    const part = object(rawPart, `缺件明细 ${index + 1}`)
    return {
      id: text(part.id, `缺件明细 ${index + 1} 编号`, 1, 100),
      name: text(part.name, `缺件明细 ${index + 1} 名称`, 1, 100),
      quantity: Number(part.quantity)
    }
  })
}

function boardGameSummary(row: BoardGameRow): BoardGameSummary {
  return {
    id: row.id,
    baseGameId: row.base_game_id,
    name: row.name,
    introduction: row.introduction,
    categories: stringArray(row.categories_json, '桌游分类'),
    minPlayers: Number(row.min_players),
    maxPlayers: Number(row.max_players),
    minMinutes: row.min_minutes === null ? null : Number(row.min_minutes),
    maxMinutes: row.max_minutes === null ? null : Number(row.max_minutes),
    difficulty: row.difficulty,
    complexityRating:
      row.complexity_rating === null ? null : Number(row.complexity_rating),
    quantity: Number(row.quantity),
    recordStatus: row.record_status,
    available: row.available,
    customerConsigned: row.customer_consigned,
    missingPieces: row.missing_pieces,
    private: row.private,
    recommended: row.recommended,
    imageUrl: row.image_url,
    localImagePath: null,
    bggId: row.bgg_id === null ? null : Number(row.bgg_id),
    metadataSource: row.metadata_source,
    metadataImportedAt:
      row.metadata_imported_at === null
        ? null
        : new Date(row.metadata_imported_at).toISOString(),
    customerNote: row.customer_note,
    internalNote: row.internal_note,
    consignorNickname: row.consignor_nickname,
    missingParts: missingParts(row.missing_parts_json),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  }
}

function storeSummary(row: StoreRow): StoreProfileSummary {
  return {
    storeId: row.id,
    name: row.name,
    address: row.address,
    contactPhone: row.contact_phone,
    businessOpenMinute: Number(row.business_open_minute),
    businessCloseMinute: Number(row.business_close_minute),
    statusOverride: row.status_override,
    customStatusText: row.custom_status_text,
    updatedAt: new Date(row.updated_at).toISOString()
  }
}

@Injectable()
export class EmployeeContentService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async listAnnouncements(
    principal: MiniappPrincipal
  ): Promise<AnnouncementSummary[]> {
    this.requirePermission(principal, PERMISSIONS.contentManage, true)
    const result = await this.pool.query<AnnouncementRow>(
      `${this.announcementSelect()}
       WHERE tenant_id = $1 AND store_id = $2
       ORDER BY pinned DESC, visible_from DESC, created_at DESC`,
      [principal.tenantId, principal.storeId]
    )
    const now = new Date()
    return result.rows.map((row) => announcementSummary(row, now))
  }

  async createAnnouncement(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<AnnouncementSummary> {
    const employeeId = this.requirePermission(
      principal,
      PERMISSIONS.contentManage,
      true
    )
    let input: EmployeeMobileCreateAnnouncementRequest
    try {
      input = createAnnouncementInput(rawInput)
    } catch (error) {
      throw this.badRequest(error, '公告请求不正确')
    }
    return this.withIdempotency(
      principal,
      employeeId,
      'announcement-create',
      input.requestId,
      input,
      async (client) => {
        const id = randomUUID()
        const occurredAt = new Date().toISOString()
        const after: AnnouncementSummary = {
          id,
          title: input.title,
          content: input.content,
          status: 'draft',
          visibility: 'draft',
          pinned: input.pinned,
          visibleFrom: input.visibleFrom,
          visibleUntil: input.visibleUntil ?? null,
          publishedAt: null,
          createdAt: occurredAt,
          updatedAt: occurredAt
        }
        const version = await this.appendEvent(
          client,
          principal,
          'announcement',
          id,
          'announcement.created',
          { action: 'announcement.created', announcementId: id, before: null, after, reason: '移动端创建公告草稿' },
          occurredAt
        )
        await client.query(
          `INSERT INTO cloud_announcement
           (id, tenant_id, store_id, title, content, status, pinned,
            visible_from, visible_until, published_at, server_version,
            created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            id,
            principal.tenantId,
            principal.storeId,
            after.title,
            after.content,
            after.status,
            after.pinned,
            after.visibleFrom,
            after.visibleUntil,
            after.publishedAt,
            version,
            after.createdAt,
            after.updatedAt
          ]
        )
        await this.appendAudit(
          client,
          principal,
          employeeId,
          'announcement.created',
          'announcement',
          id,
          { source: 'employee_mobile' },
          occurredAt
        )
        return after
      }
    )
  }

  async updateAnnouncement(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<AnnouncementSummary> {
    const employeeId = this.requirePermission(
      principal,
      PERMISSIONS.contentManage,
      true
    )
    let input: EmployeeMobileUpdateAnnouncementRequest
    try {
      input = updateAnnouncementInput(rawInput)
    } catch (error) {
      throw this.badRequest(error, '公告请求不正确')
    }
    return this.withIdempotency(
      principal,
      employeeId,
      'announcement-update',
      input.requestId,
      input,
      async (client) => {
        const before = await this.loadAnnouncement(
          client,
          principal,
          input.announcementId,
          true
        )
        const occurredAt = new Date().toISOString()
        const after: AnnouncementSummary = {
          ...before,
          title: input.title,
          content: input.content,
          pinned: input.pinned,
          visibleFrom: input.visibleFrom,
          visibleUntil: input.visibleUntil ?? null,
          visibility: announcementVisibility(
            before.status,
            input.visibleFrom,
            input.visibleUntil ?? null,
            new Date(occurredAt)
          ),
          updatedAt: occurredAt
        }
        const version = await this.appendEvent(
          client,
          principal,
          'announcement',
          before.id,
          'announcement.updated',
          {
            action: 'announcement.updated',
            announcementId: before.id,
            before,
            after,
            reason: input.reason
          },
          occurredAt
        )
        await this.updateAnnouncementProjection(
          client,
          principal,
          after,
          version
        )
        await this.appendAudit(
          client,
          principal,
          employeeId,
          'announcement.updated',
          'announcement',
          before.id,
          { source: 'employee_mobile', reason: input.reason },
          occurredAt
        )
        return after
      }
    )
  }

  async setAnnouncementStatus(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<AnnouncementSummary> {
    const employeeId = this.requirePermission(
      principal,
      PERMISSIONS.contentManage,
      true
    )
    let input: EmployeeMobileSetAnnouncementStatusRequest
    try {
      input = announcementStatusInput(rawInput)
    } catch (error) {
      throw this.badRequest(error, '公告状态请求不正确')
    }
    return this.withIdempotency(
      principal,
      employeeId,
      `announcement-${input.status}`,
      input.requestId,
      input,
      async (client) => {
        const before = await this.loadAnnouncement(
          client,
          principal,
          input.announcementId,
          true
        )
        const occurredAt = new Date().toISOString()
        const action =
          input.status === 'published'
            ? 'announcement.published'
            : 'announcement.disabled'
        const after: AnnouncementSummary = {
          ...before,
          status: input.status,
          visibility: announcementVisibility(
            input.status,
            before.visibleFrom,
            before.visibleUntil,
            new Date(occurredAt)
          ),
          publishedAt:
            input.status === 'published' ? occurredAt : before.publishedAt,
          updatedAt: occurredAt
        }
        const version = await this.appendEvent(
          client,
          principal,
          'announcement',
          before.id,
          action,
          {
            action,
            announcementId: before.id,
            before,
            after,
            reason: input.reason
          },
          occurredAt
        )
        await this.updateAnnouncementProjection(
          client,
          principal,
          after,
          version
        )
        await this.appendAudit(
          client,
          principal,
          employeeId,
          action,
          'announcement',
          before.id,
          { source: 'employee_mobile', reason: input.reason },
          occurredAt
        )
        return after
      }
    )
  }

  async listBoardGames(
    principal: MiniappPrincipal
  ): Promise<BoardGameSummary[]> {
    this.requirePermission(principal, PERMISSIONS.contentRead)
    const result = await this.pool.query<BoardGameRow>(
      `${this.boardGameSelect()}
       WHERE tenant_id = $1 AND store_id = $2
       ORDER BY recommended DESC, name, created_at DESC`,
      [principal.tenantId, principal.storeId]
    )
    return result.rows.map(boardGameSummary)
  }

  async updateBoardGameOperations(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<BoardGameSummary> {
    const employeeId = this.requirePermission(
      principal,
      PERMISSIONS.boardGameOperationsManage
    )
    let input: EmployeeMobileUpdateBoardGameOperationsRequest
    try {
      input = boardGameOperationsInput(rawInput)
    } catch (error) {
      throw this.badRequest(error, '桌游状态请求不正确')
    }
    return this.withIdempotency(
      principal,
      employeeId,
      'board-game-operations',
      input.requestId,
      input,
      async (client) => {
        const before = await this.loadBoardGame(
          client,
          principal,
          input.boardGameId,
          true
        )
        const previousPartIds = new Map(
          before.missingParts.map((part) => [part.name, part.id])
        )
        const occurredAt = new Date().toISOString()
        const after: BoardGameSummary = {
          ...before,
          available: input.available,
          customerConsigned: input.customerConsigned,
          missingPieces: input.missingPieces,
          private: input.private,
          customerNote: input.customerNote ?? null,
          internalNote: input.internalNote ?? null,
          consignorNickname: input.customerConsigned
            ? input.consignorNickname ?? null
            : null,
          missingParts: input.missingPieces
            ? input.missingParts.map((part) => ({
                id: previousPartIds.get(part.name) ?? randomUUID(),
                ...part
              }))
            : [],
          updatedAt: occurredAt
        }
        if (
          after.recordStatus === 'active' &&
          !after.private &&
          after.available &&
          after.quantity > 0 &&
          after.complexityRating === null
        ) {
          throw new BadRequestException('公开且可用的桌游必须先填写复杂度')
        }
        const action = 'board_game.operations.updated'
        const version = await this.appendEvent(
          client,
          principal,
          'board_game',
          before.id,
          action,
          {
            action,
            boardGameId: before.id,
            before,
            after,
            reason: input.reason
          },
          occurredAt
        )
        const updated = await client.query<{ id: string }>(
          `UPDATE cloud_board_game
           SET available = $4, customer_consigned = $5,
               missing_pieces = $6, private = $7, customer_note = $8,
               internal_note = $9, consignor_nickname = $10,
               missing_parts_json = $11::jsonb, server_version = $12,
               updated_at = $13
           WHERE tenant_id = $1 AND store_id = $2 AND id = $3
           RETURNING id`,
          [
            principal.tenantId,
            principal.storeId,
            before.id,
            after.available,
            after.customerConsigned,
            after.missingPieces,
            after.private,
            after.customerNote,
            after.internalNote,
            after.consignorNickname,
            JSON.stringify(after.missingParts),
            version,
            after.updatedAt
          ]
        )
        if (!updated.rows[0]) throw new NotFoundException('桌游不存在')
        await this.appendAudit(
          client,
          principal,
          employeeId,
          action,
          'board_game',
          before.id,
          { source: 'employee_mobile', reason: input.reason },
          occurredAt
        )
        return after
      }
    )
  }

  async getStoreProfile(
    principal: MiniappPrincipal
  ): Promise<StoreProfileSummary> {
    this.requirePermission(principal, PERMISSIONS.storeProfileManage, true)
    return this.loadStore(this.pool, principal, false)
  }

  async updateStoreStatus(
    principal: MiniappPrincipal,
    rawInput: unknown
  ): Promise<StoreProfileSummary> {
    const employeeId = this.requirePermission(
      principal,
      PERMISSIONS.storeProfileManage,
      true
    )
    let input: EmployeeMobileUpdateStoreStatusRequest
    try {
      input = storeStatusInput(rawInput)
    } catch (error) {
      throw this.badRequest(error, '营业状态请求不正确')
    }
    return this.withIdempotency(
      principal,
      employeeId,
      'store-status',
      input.requestId,
      input,
      async (client) => {
        const before = await this.loadStore(client, principal, true)
        const occurredAt = new Date().toISOString()
        const after: StoreProfileSummary = {
          ...before,
          statusOverride: input.statusOverride,
          customStatusText: input.customStatusText ?? null,
          updatedAt: occurredAt
        }
        const action = 'store.profile.updated'
        await this.appendEvent(
          client,
          principal,
          'store',
          principal.storeId,
          action,
          {
            action,
            storeId: principal.storeId,
            before,
            after,
            reason: input.reason
          },
          occurredAt
        )
        const updated = await client.query<{ id: string }>(
          `UPDATE store
           SET status_override = $3, custom_status_text = $4,
               updated_at = $5
           WHERE id = $1 AND tenant_id = $2 AND status = 'active'
           RETURNING id`,
          [
            principal.storeId,
            principal.tenantId,
            after.statusOverride,
            after.customStatusText,
            after.updatedAt
          ]
        )
        if (!updated.rows[0]) throw new NotFoundException('门店不存在')
        await this.appendAudit(
          client,
          principal,
          employeeId,
          action,
          'store',
          principal.storeId,
          { source: 'employee_mobile', reason: input.reason },
          occurredAt
        )
        return after
      }
    )
  }

  private requirePermission(
    principal: MiniappPrincipal,
    permission: string,
    managerOnly = false
  ): string {
    if (
      !principal.employeeId ||
      (principal.identity.role !== 'staff' &&
        principal.identity.role !== 'manager') ||
      (managerOnly && principal.identity.role !== 'manager') ||
      !principal.identity.permissions.includes(permission)
    ) {
      throw new ForbiddenException('当前身份没有此内容管理权限')
    }
    return principal.employeeId
  }

  private badRequest(error: unknown, fallback: string): BadRequestException {
    return new BadRequestException(
      error instanceof Error ? error.message : fallback
    )
  }

  private announcementSelect(): string {
    return `SELECT id, title, content, status, pinned, visible_from,
                   visible_until, published_at, created_at, updated_at
            FROM cloud_announcement`
  }

  private async loadAnnouncement(
    client: Pick<PoolClient, 'query'>,
    principal: MiniappPrincipal,
    id: string,
    lock: boolean
  ): Promise<AnnouncementSummary> {
    const result = await client.query<AnnouncementRow>(
      `${this.announcementSelect()}
       WHERE tenant_id = $1 AND store_id = $2 AND id = $3
       LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [principal.tenantId, principal.storeId, id]
    )
    if (!result.rows[0]) throw new NotFoundException('公告不存在')
    return announcementSummary(result.rows[0])
  }

  private async updateAnnouncementProjection(
    client: PoolClient,
    principal: MiniappPrincipal,
    announcement: AnnouncementSummary,
    version: number
  ): Promise<void> {
    const updated = await client.query<{ id: string }>(
      `UPDATE cloud_announcement
       SET title = $4, content = $5, status = $6, pinned = $7,
           visible_from = $8, visible_until = $9, published_at = $10,
           server_version = $11, updated_at = $12
       WHERE tenant_id = $1 AND store_id = $2 AND id = $3
       RETURNING id`,
      [
        principal.tenantId,
        principal.storeId,
        announcement.id,
        announcement.title,
        announcement.content,
        announcement.status,
        announcement.pinned,
        announcement.visibleFrom,
        announcement.visibleUntil,
        announcement.publishedAt,
        version,
        announcement.updatedAt
      ]
    )
    if (!updated.rows[0]) throw new NotFoundException('公告不存在')
  }

  private boardGameSelect(): string {
    return `SELECT id, base_game_id, name, introduction, categories_json, min_players,
                   max_players, min_minutes, max_minutes, difficulty,
                   complexity_rating,
                   quantity, record_status, available, customer_consigned,
                   missing_pieces, private, recommended, image_url, bgg_id,
                   metadata_source, metadata_imported_at,
                   customer_note, internal_note, consignor_nickname,
                   missing_parts_json, created_at, updated_at
            FROM cloud_board_game`
  }

  private async loadBoardGame(
    client: Pick<PoolClient, 'query'>,
    principal: MiniappPrincipal,
    id: string,
    lock: boolean
  ): Promise<BoardGameSummary> {
    const result = await client.query<BoardGameRow>(
      `${this.boardGameSelect()}
       WHERE tenant_id = $1 AND store_id = $2 AND id = $3
       LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [principal.tenantId, principal.storeId, id]
    )
    if (!result.rows[0]) throw new NotFoundException('桌游不存在')
    return boardGameSummary(result.rows[0])
  }

  private async loadStore(
    client: Pick<PoolClient, 'query'>,
    principal: MiniappPrincipal,
    lock: boolean
  ): Promise<StoreProfileSummary> {
    const result = await client.query<StoreRow>(
      `SELECT id, name, address, contact_phone, business_open_minute,
              business_close_minute, status_override, custom_status_text,
              updated_at
       FROM store
       WHERE id = $1 AND tenant_id = $2 AND status = 'active'
       LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [principal.storeId, principal.tenantId]
    )
    if (!result.rows[0]) throw new NotFoundException('门店不存在')
    return storeSummary(result.rows[0])
  }

  private async withIdempotency<T>(
    principal: MiniappPrincipal,
    employeeId: string,
    operation: string,
    requestIdValue: string,
    payload: unknown,
    mutation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const requestHash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex')
    const key =
      `employee-mobile-content-${operation}:${employeeId}:${requestIdValue}`
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const reserved = await client.query<{ key: string }>(
        `INSERT INTO api_idempotency
         (tenant_id, key, request_hash, expires_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '24 hours')
         ON CONFLICT (tenant_id, key) DO NOTHING
         RETURNING key`,
        [principal.tenantId, key, requestHash]
      )
      if (!reserved.rows[0]) {
        const previous = await client.query<{
          request_hash: string
          response_json: T | null
        }>(
          `SELECT request_hash, response_json
           FROM api_idempotency
           WHERE tenant_id = $1 AND key = $2
           FOR UPDATE`,
          [principal.tenantId, key]
        )
        const row = previous.rows[0]
        if (!row || row.request_hash !== requestHash) {
          throw new ConflictException(
            '同一请求号已经用于不同的内容管理操作'
          )
        }
        if (!row.response_json) {
          throw new ConflictException('内容管理操作仍在处理中')
        }
        await client.query('COMMIT')
        return row.response_json
      }
      const result = await mutation(client)
      await client.query(
        `UPDATE api_idempotency
         SET response_status = 200, response_json = $3::jsonb
         WHERE tenant_id = $1 AND key = $2`,
        [principal.tenantId, key, JSON.stringify(result)]
      )
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async appendEvent(
    client: PoolClient,
    principal: MiniappPrincipal,
    aggregateType: 'announcement' | 'board_game' | 'store',
    aggregateId: string,
    action: string,
    payload: unknown,
    occurredAt: string
  ): Promise<number> {
    const event = await client.query<{ sequence: number | string }>(
      `INSERT INTO cloud_event
       (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
        event_type, payload_json, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING sequence`,
      [
        randomUUID(),
        principal.tenantId,
        principal.storeId,
        aggregateType,
        aggregateId,
        action,
        JSON.stringify(payload),
        occurredAt
      ]
    )
    const sequence = Number(event.rows[0]?.sequence)
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error('云事件未返回有效序号')
    }
    return sequence
  }

  private async appendAudit(
    client: PoolClient,
    principal: MiniappPrincipal,
    employeeId: string,
    action: string,
    aggregateType: 'announcement' | 'board_game' | 'store',
    aggregateId: string,
    metadata: Record<string, unknown>,
    occurredAt: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO cloud_audit_log
       (id, tenant_id, store_id, actor_id, action, aggregate_type,
        aggregate_id, metadata_json, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        randomUUID(),
        principal.tenantId,
        principal.storeId,
        employeeId,
        action,
        aggregateType,
        aggregateId,
        JSON.stringify({
          ...metadata,
          identityId: principal.identityId
        }),
        occurredAt
      ]
    )
  }
}
