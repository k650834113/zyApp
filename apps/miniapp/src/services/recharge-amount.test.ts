import { describe, expect, it } from 'vitest'
import {
  parseRechargeAmountFen,
  quickRechargeAmounts,
  resolveRechargeAmountFen
} from './recharge-amount'

describe('member recharge amounts', () => {
  it('exposes the approved quick recharge choices', () => {
    expect(quickRechargeAmounts).toEqual([
      { principalFen: 10_000, label: '¥100' },
      { principalFen: 30_000, label: '¥300' },
      { principalFen: 50_000, label: '¥500' },
      { principalFen: 100_000, label: '¥1000' }
    ])
  })

  it.each([
    ['0.01', 1],
    ['1.2', 120],
    ['100', 10_000],
    ['100.00', 10_000],
    ['1000000.00', 100_000_000]
  ])('parses %s yuan as %i integer fen', (raw, expected) => {
    expect(parseRechargeAmountFen(raw)).toBe(expected)
  })

  it.each(['', '0', '-1', '.01', '1.001', 'abc', '1000000.01'])(
    'rejects invalid recharge amount %s',
    (raw) => {
      expect(() => parseRechargeAmountFen(raw)).toThrow(/充值金额/)
    }
  )

  it('resolves either a quick choice or custom input', () => {
    expect(resolveRechargeAmountFen(null, '0.01')).toBe(1)
    expect(resolveRechargeAmountFen(30_000, '')).toBe(30_000)
    expect(() => resolveRechargeAmountFen(null, '')).toThrow(
      '请选择或输入充值金额'
    )
  })
})
