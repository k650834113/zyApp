import { NotFoundException } from '@nestjs/common'
import type { Pool } from '@zyapp/cloud-db'
import { describe, expect, it } from 'vitest'
import type { MiniappPrincipal } from './miniapp-auth'
import { BoardGameLikeService } from './board-game-like.service'

const gameId = '33333333-3333-4333-8333-333333333333'
const principal = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  storeId: '22222222-2222-4222-8222-222222222222',
  identityId: '44444444-4444-4444-8444-444444444444'
} as MiniappPrincipal

function fakePool(playable = true): {
  pool: Pool
  statements: string[]
  transaction: () => { committed: boolean; rolledBack: boolean; released: boolean }
} {
  let liked = false
  let committed = false
  let rolledBack = false
  let released = false
  const statements: string[] = []
  const client = {
    query: async (sql: string) => {
      statements.push(sql)
      if (sql.includes('SELECT game.id')) {
        return { rows: playable ? [{ id: gameId }] : [], rowCount: playable ? 1 : 0 }
      }
      if (sql.includes('INSERT INTO miniapp_board_game_like')) {
        liked = true
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('DELETE FROM miniapp_board_game_like')) {
        liked = false
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('COUNT(*)::integer AS like_count')) {
        return {
          rows: [{ like_count: liked ? 5 : 4, liked_by_viewer: liked }],
          rowCount: 1
        }
      }
      if (sql === 'COMMIT') committed = true
      if (sql === 'ROLLBACK') rolledBack = true
      return { rows: [], rowCount: 0 }
    },
    release: () => {
      released = true
    }
  }
  return {
    pool: { connect: async () => client } as unknown as Pool,
    statements,
    transaction: () => ({ committed, rolledBack, released })
  }
}

describe('board-game likes', () => {
  it('keeps repeated liked targets idempotent and returns the authoritative count', async () => {
    const database = fakePool()
    const service = new BoardGameLikeService(database.pool)

    await expect(
      service.setLiked(principal, gameId, {
        liked: true,
        requestId: 'like-request-001'
      })
    ).resolves.toEqual({
      boardGameId: gameId,
      likedByViewer: true,
      likeCount: 5
    })
    await expect(
      service.setLiked(principal, gameId, {
        liked: true,
        requestId: 'like-request-001'
      })
    ).resolves.toEqual({
      boardGameId: gameId,
      likedByViewer: true,
      likeCount: 5
    })
    expect(database.statements.join('\n')).toContain('ON CONFLICT')
    expect(database.transaction()).toEqual({
      committed: true,
      rolledBack: false,
      released: true
    })
  })

  it('keeps repeated unliked targets at the same authoritative count', async () => {
    const database = fakePool()
    const service = new BoardGameLikeService(database.pool)
    await service.setLiked(principal, gameId, {
      liked: true,
      requestId: 'like-request-002'
    })

    await expect(
      service.setLiked(principal, gameId, {
        liked: false,
        requestId: 'unlike-request-001'
      })
    ).resolves.toEqual({
      boardGameId: gameId,
      likedByViewer: false,
      likeCount: 4
    })
    await expect(
      service.setLiked(principal, gameId, {
        liked: false,
        requestId: 'unlike-request-001'
      })
    ).resolves.toEqual({
      boardGameId: gameId,
      likedByViewer: false,
      likeCount: 4
    })
  })

  it('rolls back instead of liking a game that is not currently playable', async () => {
    const database = fakePool(false)
    const service = new BoardGameLikeService(database.pool)

    await expect(
      service.setLiked(principal, gameId, {
        liked: true,
        requestId: 'like-request-003'
      })
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(database.transaction()).toEqual({
      committed: false,
      rolledBack: true,
      released: true
    })
    expect(database.statements.join('\n')).not.toContain(
      'INSERT INTO miniapp_board_game_like'
    )
  })
})
