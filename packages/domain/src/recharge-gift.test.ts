import { describe, expect, it } from 'vitest'
import { fen } from './money'
import { calculateMaximumRechargeGift, type RechargeGiftTier } from './recharge-gift'

const defaultTiers: RechargeGiftTier[] = [
  { id: '300', principal: fen(30_000), gift: fen(2_000) },
  { id: '500', principal: fen(50_000), gift: fen(5_000) },
  { id: '1000', principal: fen(100_000), gift: fen(20_000) }
]

describe('calculateMaximumRechargeGift', () => {
  it.each([
    [299, 0],
    [300, 20],
    [499, 20],
    [500, 50],
    [999, 50],
    [1000, 200],
    [1200, 200],
    [1300, 220],
    [1500, 250],
    [2000, 400],
    [2300, 420],
    [2500, 450]
  ])('calculates %i yuan as %i yuan gift', (principalYuan, giftYuan) => {
    const result = calculateMaximumRechargeGift(fen(principalYuan * 100), defaultTiers)
    expect(result.gift).toBe(giftYuan * 100)
  })

  it('keeps unmatched principal as remainder', () => {
    const result = calculateMaximumRechargeGift(fen(130_050), defaultTiers)
    expect(result.gift).toBe(22_000)
    expect(result.remainder).toBe(50)
  })

  it('rejects an invalid tier', () => {
    expect(() =>
      calculateMaximumRechargeGift(fen(100_000), [
        { id: 'invalid', principal: fen(0), gift: fen(1) }
      ])
    ).toThrow('positive principal')
  })
})
