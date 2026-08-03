import { describe, expect, it } from 'vitest'
import type { BoardGameMetadataDetails } from '@zyapp/contracts'
import {
  applyMetadataDetails,
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

  it('applies structured metadata while preserving manager-written introduction', () => {
    const applied = applyMetadataDetails(
      { ...defaultBoardGameEditor(), introduction: '店方中文简介' },
      details,
      true
    )
    expect(applied).toMatchObject({
      name: '卡坦岛',
      introduction: '店方中文简介',
      categories: '经营、策略',
      minPlayers: '3',
      maxPlayers: '4',
      complexityRating: '2.3',
      bggId: '13',
      imageUrl: 'https://example.com/image.jpg',
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
  })

  it('validates numeric complexity and includes provenance only after import', () => {
    const imported = applyMetadataDetails(defaultBoardGameEditor(), details, false)
    expect(boardGameRequest({
      ...imported,
      introduction: '通过交易与建设发展岛屿。'
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
})
