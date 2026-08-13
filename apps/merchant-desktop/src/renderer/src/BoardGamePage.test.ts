import type { BoardGameSummary } from '@zyapp/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  BoardGameRow,
  filterBoardGames
} from './BoardGamePage'

const now = '2026-08-03T00:00:00.000Z'

function game(
  overrides: Partial<BoardGameSummary> = {}
): BoardGameSummary {
  return {
    id: 'game-13',
    baseGameId: null,
    name: '卡坦岛',
    introduction: '通过交易与建设发展岛屿。',
    categories: ['经营', '策略'],
    minPlayers: 3,
    maxPlayers: 4,
    minMinutes: 60,
    maxMinutes: 120,
    difficulty: 'medium',
    complexityRating: 2.3,
    quantity: 1,
    recordStatus: 'active',
    available: true,
    customerConsigned: false,
    missingPieces: false,
    private: false,
    recommended: true,
    imageUrl: null,
    localImagePath: null,
    bggId: 13,
    metadataSource: 'bgg',
    metadataImportedAt: now,
    customerNote: null,
    internalNote: null,
    consignorNickname: null,
    missingParts: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

describe('BoardGamePage', () => {
  it('filters by name, category, BGG ID and operational status', () => {
    const catan = game()
    const damaged = game({
      id: 'game-damaged',
      name: '损坏的策略游戏',
      bggId: 99,
      missingPieces: true,
      categories: ['策略']
    })
    const disabled = game({
      id: 'game-disabled',
      name: '停用游戏',
      bggId: null,
      recordStatus: 'disabled',
      available: false,
      recommended: false
    })
    const games = [catan, damaged, disabled]

    expect(filterBoardGames(games, {
      query: '13',
      status: 'all',
      category: 'all'
    })).toEqual([catan])
    expect(filterBoardGames(games, {
      query: '',
      status: 'missing-pieces',
      category: '策略'
    })).toEqual([damaged])
    expect(filterBoardGames(games, {
      query: '停用',
      status: 'disabled',
      category: 'all'
    })).toEqual([disabled])
  })

  it('renders a comfortable single row with placeholder, facts and actions', () => {
    const html = renderToStaticMarkup(createElement(BoardGameRow, {
      game: game(),
      cover: null,
      canManage: true,
      canOperate: true,
      onEdit: vi.fn(),
      onOperate: vi.fn(),
      onStatus: vi.fn()
    }))

    expect(html).toContain('board-game-row')
    expect(html).toContain('board-game-cover-placeholder')
    expect(html).toContain('编辑资料')
    expect(html).toContain('状态与备注')
    expect(html).toContain('BGG #13')
    expect(html).toContain('内部数量 1')
  })
})
