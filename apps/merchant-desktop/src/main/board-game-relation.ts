export function optionalBoardGameBaseGameId(
  value: unknown
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    throw new TypeError('所属基础游戏编号格式不正确')
  }
  const normalized = value.trim()
  if (normalized.length < 1 || normalized.length > 100) {
    throw new RangeError('所属基础游戏编号长度应为 1-100 个字符')
  }
  return normalized
}
