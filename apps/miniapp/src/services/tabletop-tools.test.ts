import { describe, expect, it } from 'vitest'
import { wheelSlots, wheelStopAngle } from './wheel'
import {
  createRandomTeams,
  diceExpression,
  flipCoin,
  pickFirstPlayer,
  rollDice,
  rollDiceCombination,
  scoreTotals,
  scoreValue,
  shuffledPlayerNumbers
} from './tabletop-tools'

describe('tabletop tools', () => {
  it('gives each quantity one equal wheel sector and rejects invalid configurations', () => {
    expect(wheelSlots([{ id: 1, name: 'A', count: 2 }, { id: 2, name: 'B', count: 1 }])).toEqual([1, 1, 2])
    for (const count of [0, -1, 1.5, 61, NaN]) {
      expect(() => wheelSlots([{ id: 1, name: 'A', count }])).toThrow()
    }
    expect(() => wheelSlots([])).toThrow()
    expect(() => wheelSlots([{ id: 1, name: ' ', count: 1 }])).toThrow()
    expect(() => wheelSlots([{ id: 1, name: 'A', count: 40 }, { id: 2, name: 'B', count: 30 }])).toThrow()
  })

  it('stops every wheel sector under the fixed pointer after at least three turns', () => {
    for (const total of [1, 3, 7, 60]) {
      for (let slot = 0; slot < total; slot++) {
        for (const current of [0, 345, 12570]) {
          const angle = wheelStopAngle(current, slot, total)
          expect(angle - current).toBeGreaterThanOrEqual(1080)
          const pointer = (360 - angle % 360) % 360
          expect(Math.floor(pointer / (360 / total))).toBe(slot)
        }
      }
    }
  })
  it('selects a first player with an injected random source', () => {
    expect(pickFirstPlayer(['甲', '乙', '丙'], () => 0.5)).toBe('乙')
  })

  it('shuffles every player exactly once', () => {
    expect(shuffledPlayerNumbers(5, () => 0)).toEqual([2, 3, 4, 5, 1])
  })

  it('creates balanced teams without dropping players', () => {
    const teams = createRandomTeams(7, 3, () => 0)
    expect(teams.flat().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(teams.map((team) => team.length).sort()).toEqual([2, 2, 3])
  })

  it('rolls the requested number and range of dice', () => {
    expect(rollDice(3, 6, () => 0)).toEqual([1, 1, 1])
    expect(rollDice(2, 20, () => 0.999)).toEqual([20, 20])
  })

  it('rolls mixed dice combinations and exposes a readable expression', () => {
    const groups = [{ count: 1, sides: 4 }, { count: 2, sides: 6 }]
    expect(diceExpression(groups)).toBe('1D4 + 2D6')
    expect(rollDiceCombination(groups, () => 0)).toEqual([
      { id: '0-0', groupIndex: 0, sides: 4, value: 1 },
      { id: '1-0', groupIndex: 1, sides: 6, value: 1 },
      { id: '1-1', groupIndex: 1, sides: 6, value: 1 }
    ])
  })

  it('flips both coin faces deterministically', () => {
    expect(flipCoin(() => 0)).toBe('正面')
    expect(flipCoin(() => 0.9)).toBe('反面')
  })

  it('totals signed decimal score cells by player', () => {
    expect(scoreValue('-1.25')).toBe(-1.25)
    expect(scoreValue('未填写')).toBe(0)
    expect(scoreTotals([
      ['1.5', '-2'],
      ['2.25', '3.5']
    ], 2)).toEqual([3.75, 1.5])
  })
})
