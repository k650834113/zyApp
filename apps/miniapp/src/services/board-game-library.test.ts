import { describe, expect, it } from 'vitest'
import type { PublicBoardGameSummary } from '@zyapp/contracts'
import {
  cleanBoardGameFilters,
  matchesBoardGameFilters,
  toBoardGameCardView,
  withLikeResult
} from './board-game-library'

const game: PublicBoardGameSummary = {
  id: 'game-splendor',
  name: '璀璨宝石',
  introduction: '收集宝石并发展矿场。',
  categories: ['德式', '策略', '竞争'],
  minPlayers: 2,
  maxPlayers: 4,
  minMinutes: 30,
  maxMinutes: 45,
  complexityRating: 2.3,
  imageUrl: null,
  customerNote: null,
  sourceAttribution: null,
  likeCount: 18,
  likedByViewer: false
}

describe('board-game card view model', () => {
  it('preserves safe public source attribution without exposing provenance fields', () => {
    const view = toBoardGameCardView({
      ...game,
      sourceAttribution: {
        label: 'Powered by BGG',
        url: 'https://boardgamegeek.com/boardgame/13'
      }
    })
    expect(view.sourceAttribution).toEqual({
      label: 'Powered by BGG',
      url: 'https://boardgamegeek.com/boardgame/13'
    })
    expect(JSON.stringify(view)).not.toContain('metadataSource')
  })

  it('formats players, duration, and numeric complexity for one metadata row', () => {
    expect(toBoardGameCardView(game)).toMatchObject({
      playersText: '2–4 人',
      durationText: '30–45 分钟',
      complexityText: '复杂度 2.3/5',
      expanded: false,
      likeBusy: false,
      imageFailed: false
    })
  })

  it('shows readable fallbacks for missing duration and complexity', () => {
    expect(
      toBoardGameCardView({
        ...game,
        minMinutes: null,
        maxMinutes: null,
        complexityRating: null
      })
    ).toMatchObject({
      durationText: '时长待补充',
      complexityText: '复杂度待补充'
    })
  })

  it('merges an authoritative like response without losing expansion state', () => {
    const expanded = toBoardGameCardView(game, { expanded: true, likeBusy: true })
    expect(
      withLikeResult([expanded], {
        boardGameId: game.id,
        likedByViewer: true,
        likeCount: 19
      })
    ).toEqual([
      expect.objectContaining({
        expanded: true,
        likeBusy: false,
        likedByViewer: true,
        likeCount: 19
      })
    ])
  })
})

describe('board-game filter semantics', () => {
  it('removes blank and empty values before a request', () => {
    expect(
      cleanBoardGameFilters({
        query: '  宝石  ',
        categories: [],
        minPlayers: 2
      })
    ).toEqual({ query: '宝石', minPlayers: 2 })
  })

  it('requires every selected category and complete player coverage', () => {
    expect(
      matchesBoardGameFilters(game, {
        categories: ['德式', '策略'],
        minPlayers: 2,
        maxPlayers: 4
      })
    ).toBe(true)
    expect(matchesBoardGameFilters(game, { categories: ['聚会'] })).toBe(false)
    expect(
      matchesBoardGameFilters(game, { minPlayers: 1, maxPlayers: 4 })
    ).toBe(false)
  })

  it('uses time overlap and excludes null complexity only when filtered', () => {
    expect(
      matchesBoardGameFilters(game, { minMinutes: 40, maxMinutes: 60 })
    ).toBe(true)
    expect(
      matchesBoardGameFilters(game, { minMinutes: 60, maxMinutes: 90 })
    ).toBe(false)
    expect(
      matchesBoardGameFilters({ ...game, complexityRating: null }, {})
    ).toBe(true)
    expect(
      matchesBoardGameFilters(
        { ...game, complexityRating: null },
        { minComplexity: 1, maxComplexity: 3 }
      )
    ).toBe(false)
  })
})
