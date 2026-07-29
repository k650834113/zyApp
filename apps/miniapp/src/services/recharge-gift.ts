type RechargeGiftTier = {
  principalFen: number
  giftFen: number
}

export function calculateRechargeGift(
  principalFen: number,
  tiers: RechargeGiftTier[]
): number {
  const sorted = [...tiers].sort(
    (left, right) => left.principalFen - right.principalFen
  )
  const highest = sorted[sorted.length - 1]
  if (!highest || principalFen < 1) return 0

  let remainderFen = principalFen
  let giftFen = 0
  if (remainderFen >= highest.principalFen) {
    const count = Math.floor(remainderFen / highest.principalFen)
    giftFen += count * highest.giftFen
    remainderFen -= count * highest.principalFen
  }
  const remainderTier = [...sorted]
    .reverse()
    .find((tier) => tier.principalFen <= remainderFen)
  return giftFen + (remainderTier?.giftFen ?? 0)
}

export function formatRechargeRuleContent(
  tiers: RechargeGiftTier[]
): string {
  if (tiers.length === 0) {
    return '当前暂无赠送规则。最终赠送以创建订单时服务端返回结果为准。'
  }
  const tierContent = [...tiers]
    .sort((left, right) => left.principalFen - right.principalFen)
    .map(
      (tier) =>
        `充 ¥${formatFen(tier.principalFen)} 赠 ¥${formatFen(tier.giftFen)}`
    )
    .join('\n')
  return `${tierContent}\n\n达到最高档后可重复计算；余数最多再匹配一个档位。最终赠送以创建订单时服务端返回结果为准。`
}

function formatFen(fen: number): string {
  return (fen / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1')
}
