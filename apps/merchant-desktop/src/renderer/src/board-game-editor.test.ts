import { describe, expect, it } from 'vitest'
import type {
  BoardGameMetadataDetails,
  BoardGameSummary
} from '@zyapp/contracts'
import {
  applyMetadataDetails,
  boardGameEditorFor,
  boardGameRequest,
  defaultBoardGameEditor,
  findBoardGameByBggId,
  parseBggLookupInput
} from './board-game-editor'

const details: BoardGameMetadataDetails = {
  source: 'bgg',
  externalId: '13',
  primaryName: 'Catan',
  alternateNames: ['Die Siedler von Catan', '卡坦岛'],
  yearPublished: 1995,
  minPlayers: 3,
  maxPlayers: 4,
  minMinutes: 60,
  maxMinutes: 120,
  complexityRating: 2.3,
  categories: ['经营', '策略'],
  mechanics: ['交易'],
  thumbnailUrl: 'https://example.com/thumb.jpg',
  imageUrl: 'https://example.com/image.jpg',
  sourceUrl: 'https://boardgamegeek.com/boardgame/13',
  fetchedAt: '2026-08-03T00:00:00.000Z'
}

describe('board-game quick editor', () => {
  it('recognizes numeric IDs and canonical BGG links', () => {
    expect(parseBggLookupInput('13')).toEqual({
      kind: 'id', externalId: '13'
    })
    expect(
      parseBggLookupInput('https://boardgamegeek.com/boardgame/13/catan')
    ).toEqual({ kind: 'id', externalId: '13' })
    expect(() => parseBggLookupInput('https://example.com/boardgame/13'))
      .toThrow(/BGG/i)
    expect(parseBggLookupInput('卡坦岛')).toEqual({
      kind: 'query', query: '卡坦岛'
    })
  })

  it('applies structured metadata while preserving manager-reviewed content', () => {
    const applied = applyMetadataDetails(
      {
        ...defaultBoardGameEditor(),
        introduction: '店方中文简介',
        categories: '德式、竞争'
      },
      details,
      true
    )
    expect(applied).toMatchObject({
      name: '卡坦岛',
      introduction: '店方中文简介',
      categories: '德式、竞争',
      minPlayers: '3',
      maxPlayers: '4',
      complexityRating: '2.3',
      bggId: '13',
      imageUrl: 'https://example.com/image.jpg',
      coverSource: 'bgg',
      metadataSource: 'bgg',
      metadataImportedAt: details.fetchedAt
    })
  })

  it('does not use BGG images without permission and leaves untranslated names blank', () => {
    const result = applyMetadataDetails(
      defaultBoardGameEditor(),
      { ...details, alternateNames: [] },
      false
    )
    expect(result.name).toBe('')
    expect(result.imageUrl).toBe('')
    expect(result.coverSource).toBe('none')
  })

  it('validates numeric complexity and includes provenance only after import', () => {
    const imported = applyMetadataDetails(defaultBoardGameEditor(), details, false)
    expect(boardGameRequest({
      ...imported,
      introduction: '通过交易与建设发展岛屿。',
      categories: '德式、竞争、建设、交易'
    })).toMatchObject({
      name: '卡坦岛',
      complexityRating: 2.3,
      bggId: 13,
      metadataSource: 'bgg',
      metadataImportedAt: details.fetchedAt
    })

    expect(() => boardGameRequest({
      ...defaultBoardGameEditor(),
      name: '测试',
      introduction: '中文简介',
      categories: '策略',
      complexityRating: '2.34'
    })).toThrow(/复杂度/)
  })

  it('finds an existing tenant game before creating the same BGG item', () => {
    const existing = { id: 'game-13', bggId: 13 }
    expect(findBoardGameByBggId([existing], 13)).toBe(existing)
    expect(findBoardGameByBggId([existing], 14)).toBeNull()
    expect(findBoardGameByBggId([existing], undefined)).toBeNull()
  })

  it('tracks persisted cached, local and external cover sources', () => {
    const game = {
      id: 'game-13',
      baseGameId: null,
      name: '卡坦岛',
      introduction: '通过交易与建设发展岛屿。',
      categories: ['经营'],
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
      imageUrl:
        `https://judian.icu/test/v1/public/board-game-covers/${'a'.repeat(64)}.jpg`,
      localImagePath: null,
      bggId: 13,
      metadataSource: 'bgg',
      metadataImportedAt: details.fetchedAt,
      customerNote: null,
      internalNote: null,
      consignorNickname: null,
      missingParts: [],
      createdAt: details.fetchedAt,
      updatedAt: details.fetchedAt
    } satisfies BoardGameSummary

    expect(boardGameEditorFor(game).coverSource).toBe('cached')
    expect(boardGameEditorFor({
      ...game,
      imageUrl: 'https://images.example.com/catan.jpg'
    }).coverSource).toBe('external')
    expect(boardGameEditorFor({
      ...game,
      imageUrl: null,
      localImagePath: 'board-games/catan.jpg'
    }).coverSource).toBe('local')
    expect(defaultBoardGameEditor().coverSource).toBe('none')
  })

  it('includes cover source in the desktop save request', () => {
    expect(boardGameRequest({
      ...defaultBoardGameEditor(),
      name: '测试桌游',
      introduction: '用于验证封面来源。',
      categories: '策略',
      private: true,
      coverSource: 'external',
      imageUrl: 'https://images.example.com/game.jpg'
    })).toMatchObject({
      coverSource: 'external',
      imageUrl: 'https://images.example.com/game.jpg'
    })
  })

  it('includes the selected base game only for an expansion', () => {
    expect(boardGameRequest({
      ...defaultBoardGameEditor(),
      gameKind: 'expansion',
      baseGameId: 'game-catan',
      name: '卡坦岛：航海家',
      introduction: '卡坦岛扩展。',
      categories: '策略',
      private: true
    })).toMatchObject({ baseGameId: 'game-catan' })
    expect(boardGameRequest({
      ...defaultBoardGameEditor(),
      name: '卡坦岛',
      introduction: '基础游戏。',
      categories: '策略',
      private: true
    })).not.toHaveProperty('baseGameId')
  })

  it('requires a base-game relation before saving an expansion', () => {
    expect(() => boardGameRequest({
      ...defaultBoardGameEditor(),
      gameKind: 'expansion',
      name: '卡坦岛：航海家',
      introduction: '卡坦岛扩展。',
      categories: '策略',
      private: true
    })).toThrow(/扩展必须选择所属基础游戏/)
  })
})
