import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from '@zyapp/cloud-db'
import type { MiniappContentDraft, MiniappContentWorkspace } from '@zyapp/contracts'
import type { DevicePrincipal } from './device-auth'
import { POSTGRES_POOL } from './infrastructure.module'
import { BoardGameCoverCacheService, type BoardGameCoverUpload } from './board-game-cover-cache.service'
import { contentRevision, validateContentCommand, validateMiniappContent } from './miniapp-content-validation'

type WorkspaceRow = { revision: string | null; draft_json: MiniappContentWorkspace['draft']; published_json: MiniappContentWorkspace['published'] }
function workspace(row?: WorkspaceRow): MiniappContentWorkspace {
  return { revision: row?.revision ?? null, draft: row?.draft_json ?? null, published: row?.published_json ?? null }
}

@Injectable()
export class MiniappContentService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(BoardGameCoverCacheService) private readonly covers: BoardGameCoverCacheService
  ) {}

  private async requireManager(db: Pool | PoolClient, principal: DevicePrincipal, actorId: string) {
    if (!contentRevision(actorId)) throw new BadRequestException('actorId is required')
    const result = await db.query(
      `SELECT employee.id FROM cloud_employee employee
       JOIN cloud_employee_store_access access ON access.tenant_id = employee.tenant_id
        AND access.employee_id = employee.id AND access.store_id = $3
       JOIN store ON store.id = access.store_id AND store.tenant_id = employee.tenant_id
       WHERE employee.id = $1 AND employee.tenant_id = $2 AND employee.status = 'active'
         AND access.status = 'active' AND access.role = 'manager' AND store.status = 'active'`,
      [actorId, principal.tenantId, principal.storeId]
    )
    if (!result.rows.length) throw new ForbiddenException('Manager access is required')
  }

  async read(principal: DevicePrincipal, actorId: string): Promise<MiniappContentWorkspace> {
    await this.requireManager(this.pool, principal, actorId)
    const result = await this.pool.query<WorkspaceRow>(
      'SELECT revision, draft_json, published_json FROM miniapp_content_workspace WHERE tenant_id = $1 AND store_id = $2',
      [principal.tenantId, principal.storeId]
    )
    return workspace(result.rows[0])
  }

  async history(principal: DevicePrincipal, actorId: string) {
    await this.requireManager(this.pool, principal, actorId)
    const result = await this.pool.query<{revision:string;action:string;created_at:Date}>(
      `SELECT revision, action, created_at FROM miniapp_content_event
       WHERE tenant_id = $1 AND store_id = $2 ORDER BY created_at DESC, revision DESC LIMIT 50`,
      [principal.tenantId, principal.storeId]
    )
    return result.rows.map(row => ({revision:row.revision,action:row.action,createdAt:new Date(row.created_at).toISOString()}))
  }

  async upload(principal: DevicePrincipal, actorId: string, file?: BoardGameCoverUpload) {
    await this.requireManager(this.pool, principal, actorId)
    if (!file) throw new BadRequestException('Image is required')
    const result = await this.covers.cacheLocal(file)
    await this.pool.query(
      `INSERT INTO miniapp_content_media (tenant_id, store_id, url, actor_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, store_id, url) DO NOTHING`,
      [principal.tenantId, principal.storeId, result.cachedUrl, actorId]
    )
    return result
  }

  private async validateMedia(db: PoolClient, principal: DevicePrincipal, content: MiniappContentDraft) {
    const activityIds=(content.activityDisplays??[]).map(r=>r.activityId)
    const gameIds=(content.recommendationDisplays??[]).map(r=>r.gameId)
    if(activityIds.length){
      const r=await db.query('SELECT id FROM cloud_activity_campaign WHERE tenant_id=$1 AND store_id=$2 AND id=ANY($3::uuid[])',[principal.tenantId,principal.storeId,activityIds])
      if(r.rows.length!==activityIds.length)throw new BadRequestException('Activity does not belong to this store')
    }
    if(gameIds.length){
      const r=await db.query('SELECT id FROM cloud_board_game WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[principal.tenantId,gameIds])
      if(r.rows.length!==gameIds.length)throw new BadRequestException('Game does not belong to this tenant')
    }
    const urls = [...new Set([content.storePhotoUrl, content.homeHeroUrl, content.recommendationHeroUrl,...(content.activityDisplays??[]).flatMap(r=>[r.coverUrl,r.posterUrl])].filter((url): url is string => !!url))]
    if (!urls.length) return
    const result = await db.query<{url:string}>(
      'SELECT url FROM miniapp_content_media WHERE tenant_id = $1 AND store_id = $2 AND url = ANY($3::text[])',
      [principal.tenantId, principal.storeId, urls]
    )
    if (urls.some(url => !result.rows.some(row => row.url === url))) throw new BadRequestException('Upload images for this store before publishing')
  }

  async execute(principal: DevicePrincipal, actorId: string, input: unknown): Promise<MiniappContentWorkspace> {
    const command = validateContentCommand(input)
    const hash = createHash('sha256').update(JSON.stringify({actorId,command})).digest('hex')
    const db = await this.pool.connect()
    try {
      await db.query('BEGIN')
      await this.requireManager(db, principal, actorId)
      await db.query(
        `INSERT INTO miniapp_content_workspace (tenant_id, store_id) VALUES ($1, $2) ON CONFLICT (store_id) DO NOTHING`,
        [principal.tenantId, principal.storeId]
      )
      // A store row serializes first publication, edits, withdrawal, and retry checks.
      const locked = await db.query<WorkspaceRow>(
        `SELECT revision, draft_json, published_json FROM miniapp_content_workspace
         WHERE tenant_id = $1 AND store_id = $2 FOR UPDATE`,
        [principal.tenantId, principal.storeId]
      )
      if (!locked.rows[0]) throw new ForbiddenException('Store scope mismatch')
      const previous = await db.query<{request_hash:string;result_json:MiniappContentWorkspace}>(
        `SELECT request_hash, result_json FROM miniapp_content_event WHERE tenant_id = $1 AND store_id = $2 AND request_id = $3`,
        [principal.tenantId, principal.storeId, command.requestId]
      )
      if (previous.rows[0]) {
        if (previous.rows[0].request_hash !== hash) throw new ConflictException('Request ID was already used for different content')
        await db.query('COMMIT')
        return previous.rows[0].result_json
      }
      const current = workspace(locked.rows[0])
      if (command.expectedRevision !== current.revision) throw new ConflictException('Content changed; reload before saving')
      const revision = randomUUID()
      const next: MiniappContentWorkspace = {...current,revision}
      if (command.action === 'save') {
        await this.validateMedia(db,principal,command.content)
        next.draft = command.content
      } else if (command.action === 'withdraw') {
        next.published = null
      } else {
        let draft = current.draft
        if (command.action === 'restore') {
          const source = await db.query<{result_json:MiniappContentWorkspace}>(
            `SELECT result_json FROM miniapp_content_event WHERE tenant_id = $1 AND store_id = $2
             AND revision = $3 AND action IN ('publish', 'restore')`,
            [principal.tenantId, principal.storeId, command.sourceRevision]
          )
          const published = source.rows[0]?.result_json.published
          if (!published) throw new NotFoundException('Published revision was not found')
          const {revision: _revision, publishedAt: _publishedAt, ...fields} = published
          draft = validateMiniappContent(fields)
        }
        if (!draft) throw new BadRequestException('Save a draft before publishing')
        await this.validateMedia(db,principal,draft)
        if (draft.pricing?.rows.length) {
          const prices = await db.query<{name:string;regular:number;member:number}>(
            `SELECT item.name, COALESCE(config.regular_price_fen,item.regular_price_fen) AS regular,
             COALESCE(config.advanced_price_fen,item.advanced_price_fen) AS member
             FROM cloud_catalog_item item
             LEFT JOIN cloud_catalog_store_config config ON config.tenant_id=item.tenant_id
              AND config.store_id=$2 AND config.catalog_item_id=item.id
             WHERE item.tenant_id=$1 AND item.item_type='admission'
              AND COALESCE(config.status,item.status)='active'
              AND COALESCE(config.availability,item.availability)='available'`,
            [principal.tenantId,principal.storeId]
          )
          const fen = (value:string) => {
            const match = /^(?:[¥￥]\s*)?(\d+)(?:\.(\d{1,2}))?\s*(?:元)?$/.exec(value.trim())
            return match ? Number(match[1])*100 + Number((match[2] ?? '').padEnd(2,'0')) : null
          }
          if (draft.pricing.rows.some(row => !prices.rows.some(price => price.name === row.label &&
            Number(price.regular) === fen(row.regular) && Number(price.member) === fen(row.member)))) {
            throw new BadRequestException('收费说明与当前收费配置不一致，请重新读取小程序当前内容并选择收费项目')
          }
        }
        next.published = {...draft,revision,publishedAt:new Date().toISOString()}
      }
      await db.query(
        `UPDATE miniapp_content_workspace SET revision = $3, draft_json = $4::jsonb,
         published_json = $5::jsonb, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND store_id = $2`,
        [principal.tenantId, principal.storeId, revision, JSON.stringify(next.draft), JSON.stringify(next.published)]
      )
      await db.query(
        `INSERT INTO miniapp_content_event (revision,tenant_id,store_id,device_id,actor_id,request_id,request_hash,action,result_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [revision,principal.tenantId,principal.storeId,principal.deviceId,actorId,command.requestId,hash,command.action,JSON.stringify(next)]
      )
      await db.query('COMMIT')
      return next
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally { db.release() }
  }
}
