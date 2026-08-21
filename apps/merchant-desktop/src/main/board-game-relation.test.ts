import { describe, expect, it } from 'vitest'
import { optionalBoardGameBaseGameId } from './board-game-relation'

describe('desktop board-game relation validation', () => {
  it('preserves a selected base-game id through IPC validation', () => {
    expect(optionalBoardGameBaseGameId('  game-catan  ')).toBe('game-catan')
  })

  it('uses an absent relation for a base game', () => {
    expect(optionalBoardGameBaseGameId(undefined)).toBeUndefined()
    expect(optionalBoardGameBaseGameId('')).toBeUndefined()
  })

  it('rejects malformed relation ids', () => {
    expect(() => optionalBoardGameBaseGameId(13)).toThrow(/格式/)
    expect(() => optionalBoardGameBaseGameId(' '.repeat(101))).toThrow(/长度/)
  })
})
