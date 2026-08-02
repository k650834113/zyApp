import { describe, expect, it } from 'vitest'
import {
  nearestHandle,
  normalizeRange,
  valueFromPosition
} from './range-values'

describe('range values', () => {
  it('orders crossed endpoints and clamps them to the configured range', () => {
    expect(
      normalizeRange({ min: 1, max: 12, step: 1, lower: 14, upper: 3 })
    ).toEqual({ lower: 3, upper: 12 })
  })

  it('rounds a pointer position to the configured decimal step', () => {
    expect(
      valueFromPosition({
        x: 75,
        left: 0,
        width: 100,
        min: 0,
        max: 5,
        step: 0.1
      })
    ).toBe(3.8)
  })

  it('clamps pointer positions outside the track', () => {
    expect(
      valueFromPosition({
        x: -20,
        left: 0,
        width: 100,
        min: 1,
        max: 10,
        step: 1
      })
    ).toBe(1)
  })

  it('chooses the nearest handle and preserves the active handle on a tie', () => {
    expect(nearestHandle(7, 3, 9, 'lower')).toBe('upper')
    expect(nearestHandle(6, 3, 9, 'lower')).toBe('lower')
    expect(nearestHandle(6, 3, 9, 'upper')).toBe('upper')
  })
})
