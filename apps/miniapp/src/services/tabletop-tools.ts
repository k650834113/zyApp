export type RandomSource = () => number

export type DiceGroup = {
  count: number
  sides: number
}

export type DiceResult = {
  id: string
  groupIndex: number
  sides: number
  value: number
}

export const supportedDiceSides = [4, 6, 8, 10, 12, 20] as const
export const maxDiceCount = 6

function randomIndex(length: number, random: RandomSource): number {
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new Error('候选数量必须大于 0')
  }
  const value = random()
  const normalized = Number.isFinite(value)
    ? Math.min(Math.max(value, 0), 1 - Number.EPSILON)
    : 0
  return Math.floor(normalized * length)
}

export function pickFirstPlayer<T>(
  players: readonly T[],
  random: RandomSource = Math.random
): T {
  if (players.length === 0) throw new Error('至少需要 1 位玩家')
  return players[randomIndex(players.length, random)] as T
}

export function shuffledPlayerNumbers(
  playerCount: number,
  random: RandomSource = Math.random
): number[] {
  if (!Number.isSafeInteger(playerCount) || playerCount < 2 || playerCount > 20) {
    throw new Error('玩家人数须为 2–20 人')
  }
  const players = Array.from({ length: playerCount }, (_, index) => index + 1)
  for (let index = players.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1, random)
    ;[players[index], players[target]] = [players[target] as number, players[index] as number]
  }
  return players
}

export function createRandomTeams(
  playerCount: number,
  teamCount: number,
  random: RandomSource = Math.random
): number[][] {
  if (!Number.isSafeInteger(teamCount) || teamCount < 2 || teamCount > 6) {
    throw new Error('队伍数量须为 2–6 队')
  }
  if (teamCount > playerCount) throw new Error('队伍数量不能超过玩家人数')
  const teams = Array.from({ length: teamCount }, () => [] as number[])
  for (const [index, player] of shuffledPlayerNumbers(playerCount, random).entries()) {
    teams[index % teamCount]?.push(player)
  }
  return teams
}

export function rollDice(
  diceCount: number,
  sides: number,
  random: RandomSource = Math.random
): number[] {
  if (!Number.isSafeInteger(diceCount) || diceCount < 1 || diceCount > 6) {
    throw new Error('骰子数量须为 1–6 枚')
  }
  if (!Number.isSafeInteger(sides) || sides < 2 || sides > 100) {
    throw new Error('骰子面数须为 2–100 面')
  }
  return Array.from(
    { length: diceCount },
    () => randomIndex(sides, random) + 1
  )
}

export function diceExpression(groups: readonly DiceGroup[]): string {
  return groups.map((group) => `${group.count}D${group.sides}`).join(' + ')
}

export function rollDiceCombination(
  groups: readonly DiceGroup[],
  random: RandomSource = Math.random
): DiceResult[] {
  const totalDice = groups.reduce((total, group) => total + group.count, 0)
  if (groups.length === 0 || totalDice < 1 || totalDice > maxDiceCount) {
    throw new Error(`骰子总数须为 1–${maxDiceCount} 枚`)
  }

  return groups.flatMap((group, groupIndex) => {
    if (!Number.isSafeInteger(group.count) || group.count < 1) {
      throw new Error('每组骰子至少需要 1 枚')
    }
    if (!supportedDiceSides.includes(group.sides as (typeof supportedDiceSides)[number])) {
      throw new Error('不支持该骰子面数')
    }
    return rollDice(group.count, group.sides, random).map((value, dieIndex) => ({
      id: `${groupIndex}-${dieIndex}`,
      groupIndex,
      sides: group.sides,
      value
    }))
  })
}

export function flipCoin(random: RandomSource = Math.random): '正面' | '反面' {
  return randomIndex(2, random) === 0 ? '正面' : '反面'
}

export function scoreValue(value: unknown): number {
  const text = String(value ?? '').trim()
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return 0
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : 0
}

export function scoreTotals(
  rows: readonly (readonly string[])[],
  playerCount: number
): number[] {
  if (!Number.isSafeInteger(playerCount) || playerCount < 1) {
    throw new Error('至少需要 1 位玩家')
  }
  return Array.from({ length: playerCount }, (_, playerIndex) => {
    const total = rows.reduce(
      (sum, row) => sum + scoreValue(row[playerIndex]),
      0
    )
    return Math.round((total + Number.EPSILON) * 1_000_000) / 1_000_000
  })
}
