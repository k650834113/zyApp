import { describe, expect, it } from 'vitest'
import {
  normalizePublicBoardGameFilters,
  normalizeSetBoardGameLikeRequest
} from './board-game-library'

describe('board-game library query validation', () => {
  it('normalizes repeated categories and numeric ranges', () => {
    expect(
      normalizePublicBoardGameFilters({
        query: ' 策略 ',
        categories: ['德式', '策略', '德式'],
        minPlayers: '3',
        maxPlayers: '6',
        minMinutes: '30',
        maxMinutes: '120',
        minComplexity: '1.2',
        maxComplexity: '3.5'
      })
    ).toEqual({
      query: '策略',
      categories: ['德式', '策略'],
      minPlayers: 3,
      maxPlayers: 6,
      minMinutes: 30,
      maxMinutes: 120,
      minComplexity: 1.2,
      maxComplexity: 3.5
    })
  })

  it.each([
    [{ minPlayers: '6', maxPlayers: '3' }, '人数范围'],
    [{ minMinutes: '120', maxMinutes: '30' }, '时长范围'],
    [{ minComplexity: '3.5', maxComplexity: '1.2' }, '复杂度范围'],
    [{ minComplexity: '2.35' }, '复杂度'],
    [{ categories: Array.from({ length: 11 }, (_, index) => `分类${index}`) }, '分类']
  ])('rejects invalid filter input %#', (input, message) => {
    expect(() => normalizePublicBoardGameFilters(input)).toThrow(String(message))
  })
})

describe('board-game like validation', () => {
  it('accepts an explicit target state and idempotency request id', () => {
    expect(
      normalizeSetBoardGameLikeRequest({
        liked: true,
        requestId: 'like-1700000000'
      })
    ).toEqual({ liked: true, requestId: 'like-1700000000' })
  })

  it.each([
    [{ liked: 'yes', requestId: 'like-1700000000' }, 'liked'],
    [{ liked: true, requestId: 'short' }, 'requestId'],
    [{ liked: false, requestId: 'x'.repeat(101) }, 'requestId']
  ])('rejects malformed like input %#', (input, message) => {
    expect(() => normalizeSetBoardGameLikeRequest(input)).toThrow(
      String(message)
    )
  })
})
