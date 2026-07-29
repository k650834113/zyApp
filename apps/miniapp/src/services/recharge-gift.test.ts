import { describe, expect, it } from 'vitest'
import {
  calculateRechargeGift,
  formatRechargeRuleContent
} from './recharge-gift'

const defaultTiers = [
  { principalFen: 30_000, giftFen: 2_000 },
  { principalFen: 50_000, giftFen: 5_000 },
  { principalFen: 100_000, giftFen: 20_000 }
]

describe('recharge gift preview', () => {
  it.each([
    [10_000, 0],
    [30_000, 2_000],
    [50_000, 5_000],
    [99_900, 5_000],
    [100_000, 20_000],
    [130_000, 22_000]
  ])(
    'previews %i fen as %i gift fen',
    (principalFen, giftFen) => {
      expect(
        calculateRechargeGift(principalFen, defaultTiers)
      ).toBe(giftFen)
    }
  )

  it('returns zero when the server reports no active gift rules', () => {
    expect(calculateRechargeGift(100_000, [])).toBe(0)
  })

  it('formats the current rule list and calculation explanation', () => {
    expect(formatRechargeRuleContent(defaultTiers)).toBe(
      '充 ¥300 赠 ¥20\n充 ¥500 赠 ¥50\n充 ¥1000 赠 ¥200\n\n达到最高档后可重复计算；余数最多再匹配一个档位。最终赠送以创建订单时服务端返回结果为准。'
    )
  })

  it('describes an empty rule set without inventing defaults', () => {
    expect(formatRechargeRuleContent([])).toBe(
      '当前暂无赠送规则。最终赠送以创建订单时服务端返回结果为准。'
    )
  })
})
