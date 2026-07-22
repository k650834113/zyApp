import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashPassword } from '@zyapp/auth'
import {
  createBoardGame,
  listBoardGames,
  updateBoardGameOperations
} from './board-game'
import { bootstrapStore } from './bootstrap'
import { findEmployeeRecordById, getStoreContext } from './identity'
import { openLocalDatabase } from './index'

describe('board-game repository', () => {
  it('stores multi-select operations and private consignment details', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-board-game-'))
    const local = openLocalDatabase(join(directory, 'test.db'))
    try {
      const bootstrap = bootstrapStore(local.connection, {
        storeName: 'Game store',
        deviceName: 'Cashier',
        managerUsername: 'manager',
        managerPasswordHash: await hashPassword('Password123!'),
        managerDisplayName: 'Manager'
      })
      const store = getStoreContext(local.connection)
      if (!store) throw new Error('Store missing')
      const manager = findEmployeeRecordById(
        local.connection,
        store.tenantId,
        bootstrap.managerId
      )
      if (!manager) throw new Error('Manager missing')
      const context = { ...store, actor: manager }
      const created = createBoardGame(local.connection, context, {
        name: 'Cascadia',
        introduction: 'A tile-laying family strategy game.',
        categories: ['Family', 'Strategy'],
        minPlayers: 1,
        maxPlayers: 4,
        minMinutes: 30,
        maxMinutes: 45,
        difficulty: 'light',
        quantity: 2,
        available: true,
        customerConsigned: false,
        missingPieces: false,
        private: false,
        recommended: true,
        missingParts: []
      })
      const updated = updateBoardGameOperations(local.connection, context, {
        boardGameId: created.id,
        available: true,
        customerConsigned: true,
        missingPieces: true,
        private: false,
        customerNote: 'One copy has incomplete components.',
        internalNote: 'Check before handing it to customers.',
        consignorNickname: 'Alice',
        missingParts: [{ name: 'Nature token', quantity: 2 }],
        reason: 'Record consignment and missing parts'
      })
      expect(updated).toMatchObject({
        available: true,
        customerConsigned: true,
        missingPieces: true,
        consignorNickname: 'Alice'
      })
      expect(updated.missingParts).toEqual([
        expect.objectContaining({ name: 'Nature token', quantity: 2 })
      ])
      expect(listBoardGames(local.connection, store)).toHaveLength(1)
      const otherStoreId = randomUUID()
      const now = new Date().toISOString()
      local.connection.prepare(
        `INSERT INTO store
         (id, tenant_id, name, timezone, business_open_minute,
          business_close_minute, status_override, created_at, updated_at)
         VALUES (?, ?, 'Other Game Store', 'Asia/Shanghai', 780, 1380,
                 'automatic', ?, ?)`
      ).run(otherStoreId, store.tenantId, now, now)
      const otherContext = { ...store, storeId: otherStoreId, actor: manager }
      expect(listBoardGames(local.connection, otherContext)[0]?.id).toBe(created.id)
      updateBoardGameOperations(local.connection, otherContext, {
        boardGameId: created.id,
        available: false,
        customerConsigned: false,
        missingPieces: false,
        private: true,
        missingParts: [],
        reason: 'Other-store state'
      })
      expect(listBoardGames(local.connection, store)[0]).toMatchObject({
        available: true,
        private: false
      })
      expect(listBoardGames(local.connection, otherContext)[0]).toMatchObject({
        available: false,
        private: true
      })
      const outbox = local.connection
        .prepare(
          `SELECT COUNT(*) count FROM outbox_operation
           WHERE operation_type LIKE 'board_game.%'`
        )
        .get() as { count: number }
      expect(outbox.count).toBe(3)
    } finally {
      local.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
