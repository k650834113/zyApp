import {
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import type { BoardGameLikeResult } from '@zyapp/contracts'
import type { Pool } from '@zyapp/cloud-db'
import { randomUUID } from 'node:crypto'
import {
  normalizeBoardGameId,
  normalizeSetBoardGameLikeRequest
} from './board-game-library'
import { POSTGRES_POOL } from './infrastructure.module'
import type { MiniappPrincipal } from './miniapp-auth'

@Injectable()
export class BoardGameLikeService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async setLiked(
    principal: MiniappPrincipal,
    gameIdInput: unknown,
    rawInput: unknown
  ): Promise<BoardGameLikeResult> {
    const boardGameId = normalizeBoardGameId(gameIdInput)
    const input = normalizeSetBoardGameLikeRequest(rawInput)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [
          [
            principal.tenantId,
            principal.storeId,
            boardGameId,
            principal.identityId
          ].join(':')
        ]
      )
      const playable = await client.query<{ id: string }>(
        `SELECT game.id
         FROM store current_store
         JOIN cloud_board_game game
           ON game.tenant_id = current_store.tenant_id
         LEFT JOIN cloud_board_game_store_config config
           ON config.tenant_id = current_store.tenant_id
          AND config.store_id = current_store.id
          AND config.board_game_id = game.id
         WHERE current_store.tenant_id = $1
           AND current_store.id = $2
           AND current_store.status = 'active'
           AND game.id = $3
           AND COALESCE(config.record_status, game.record_status) = 'active'
           AND COALESCE(config.private, game.private) = FALSE
           AND COALESCE(config.available, game.available) = TRUE
           AND COALESCE(config.quantity, game.quantity) > 0
           AND COALESCE(config.missing_pieces, game.missing_pieces) = FALSE
         LIMIT 1`,
        [principal.tenantId, principal.storeId, boardGameId]
      )
      if (!playable.rows[0]) {
        throw new NotFoundException('Board game is not currently playable')
      }

      if (input.liked) {
        await client.query(
          `INSERT INTO miniapp_board_game_like
           (id, tenant_id, store_id, board_game_id, viewer_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, store_id, board_game_id, viewer_id)
           DO NOTHING`,
          [
            randomUUID(),
            principal.tenantId,
            principal.storeId,
            boardGameId,
            principal.identityId
          ]
        )
      } else {
        await client.query(
          `DELETE FROM miniapp_board_game_like
           WHERE tenant_id = $1
             AND store_id = $2
             AND board_game_id = $3
             AND viewer_id = $4`,
          [
            principal.tenantId,
            principal.storeId,
            boardGameId,
            principal.identityId
          ]
        )
      }

      const aggregate = await client.query<{
        like_count: number | string
        liked_by_viewer: boolean | null
      }>(
        `SELECT COUNT(*)::integer AS like_count,
                BOOL_OR(viewer_id = $4)::boolean AS liked_by_viewer
         FROM miniapp_board_game_like
         WHERE tenant_id = $1
           AND store_id = $2
           AND board_game_id = $3`,
        [
          principal.tenantId,
          principal.storeId,
          boardGameId,
          principal.identityId
        ]
      )
      const row = aggregate.rows[0]
      const result = {
        boardGameId,
        likedByViewer: Boolean(row?.liked_by_viewer),
        likeCount: Number(row?.like_count ?? 0)
      }
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
