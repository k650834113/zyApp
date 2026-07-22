import { describe, expect, it } from 'vitest'
import { fen, formatFen, yuanToFen } from './money'

describe('money', () => {
  it('parses decimal yuan without floating point arithmetic', () => {
    expect(yuanToFen('40')).toBe(4_000)
    expect(yuanToFen('30.50')).toBe(3_050)
  })

  it('formats fen', () => {
    expect(formatFen(fen(4_000))).toBe('40.00')
    expect(formatFen(fen(-305))).toBe('-3.05')
  })

  it('rejects unsafe values and excessive decimals', () => {
    expect(() => fen(1.5)).toThrow('safe integer')
    expect(() => yuanToFen('1.001')).toThrow('two decimal')
  })
})
