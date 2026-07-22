import { nonNegativeFen, type Fen } from './money'

export type RechargeGiftTier = {
  id: string
  principal: Fen
  gift: Fen
}

export type RechargeGiftAllocation = {
  principal: Fen
  gift: Fen
  remainder: Fen
  tiers: Array<{
    tierId: string
    count: number
  }>
}

function selectBestSingleTier(
  principal: Fen,
  tiers: RechargeGiftTier[]
): RechargeGiftTier | undefined {
  return tiers
    .filter((tier) => tier.principal <= principal)
    .sort((left, right) => right.gift - left.gift || right.principal - left.principal)[0]
}

export function calculateMaximumRechargeGift(
  principal: Fen,
  tiers: RechargeGiftTier[]
): RechargeGiftAllocation {
  nonNegativeFen(principal)

  if (tiers.length === 0) {
    return { principal, gift: nonNegativeFen(0), remainder: principal, tiers: [] }
  }

  for (const tier of tiers) {
    if (tier.principal <= 0 || tier.gift < 0) {
      throw new RangeError('Recharge tiers require positive principal and non-negative gift')
    }
  }

  const sortedTiers = [...tiers].sort(
    (left, right) => left.principal - right.principal || left.gift - right.gift
  )
  const highestTier = sortedTiers.at(-1)
  if (!highestTier) {
    return { principal, gift: nonNegativeFen(0), remainder: principal, tiers: [] }
  }

  const counts = new Map<string, number>()
  let allocatedPrincipal = 0
  let totalGift = 0
  let remainder = principal

  if (principal >= highestTier.principal) {
    const count = Math.floor(principal / highestTier.principal)
    counts.set(highestTier.id, count)
    allocatedPrincipal = highestTier.principal * count
    totalGift = highestTier.gift * count
    remainder = nonNegativeFen(principal - allocatedPrincipal)
  }

  const remainderTier = selectBestSingleTier(remainder, sortedTiers)
  if (remainderTier) {
    counts.set(remainderTier.id, (counts.get(remainderTier.id) ?? 0) + 1)
    allocatedPrincipal += remainderTier.principal
    totalGift += remainderTier.gift
  }

  return {
    principal,
    gift: nonNegativeFen(totalGift),
    remainder: nonNegativeFen(principal - allocatedPrincipal),
    tiers: [...counts.entries()].map(([tierId, count]) => ({ tierId, count }))
  }
}
