import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  BoardGameCoverSource,
  BoardGameMetadataDetails,
  BoardGameSummary,
  CacheBoardGameCoverResult,
  CreateBoardGameRequest,
  PublicBoardGameSummary,
  SaveBoardGameFields
} from './index'
import { IPC_CHANNELS } from './index'

describe('board-game metadata contracts', () => {
  it('carries numeric complexity, provenance and safe public attribution', () => {
    const details = {
      source: 'bgg',
      externalId: '13',
      primaryName: 'Catan',
      alternateNames: ['卡坦岛'],
      yearPublished: 1995,
      minPlayers: 3,
      maxPlayers: 4,
      minMinutes: 60,
      maxMinutes: 120,
      complexityRating: 2.3,
      categories: ['经营'],
      mechanics: ['交易'],
      thumbnailUrl: null,
      imageUrl: null,
      sourceUrl: 'https://boardgamegeek.com/boardgame/13',
      fetchedAt: '2026-08-03T00:00:00.000Z'
    } satisfies BoardGameMetadataDetails
    const saved = {
      name: '卡坦岛',
      introduction: '通过交易和建设发展岛屿。',
      categories: ['经营'],
      minPlayers: 3,
      maxPlayers: 4,
      minMinutes: 60,
      maxMinutes: 120,
      complexityRating: 2.3,
      quantity: 1,
      available: true,
      customerConsigned: false,
      missingPieces: false,
      private: false,
      recommended: true,
      bggId: 13,
      metadataSource: 'bgg',
      metadataImportedAt: '2026-08-03T00:00:00.000Z',
      missingParts: []
    } satisfies SaveBoardGameFields
    const coverSource = 'bgg' satisfies BoardGameCoverSource
    const cachedCover = {
      source: 'bgg',
      externalId: '13',
      cachedUrl:
        `https://judian.icu/test/v1/public/board-game-covers/${'a'.repeat(64)}.jpg`,
      contentType: 'image/jpeg',
      sha256: 'a'.repeat(64)
    } satisfies CacheBoardGameCoverResult
    const createRequest = {
      ...saved,
      coverSource
    } satisfies CreateBoardGameRequest

    expect(details.externalId).toBe(String(saved.bggId))
    expect(cachedCover.cachedUrl).toContain('/v1/public/board-game-covers/')
    expect(createRequest.coverSource).toBe('bgg')
    expectTypeOf<BoardGameSummary>().toHaveProperty('complexityRating')
    expectTypeOf<PublicBoardGameSummary>().toHaveProperty('sourceAttribution')
    expect(IPC_CHANNELS).toMatchObject({
      boardGameMetadataStatus: 'board-game-metadata:status',
      boardGameMetadataSearch: 'board-game-metadata:search',
      boardGameMetadataDetails: 'board-game-metadata:details'
    })
  })
})
