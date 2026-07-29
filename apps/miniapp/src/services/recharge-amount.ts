export const quickRechargeAmounts = [
  { principalFen: 10_000, label: '¥100' },
  { principalFen: 30_000, label: '¥300' },
  { principalFen: 50_000, label: '¥500' },
  { principalFen: 100_000, label: '¥1000' }
] as const

export function parseRechargeAmountFen(raw: string): number {
  const normalized = raw.trim()
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error('请输入正确的充值金额，最多两位小数')
  }
  const [yuan, decimal = ''] = normalized.split('.')
  const fen = Number(yuan) * 100 + Number(decimal.padEnd(2, '0'))
  if (!Number.isSafeInteger(fen) || fen < 1 || fen > 100_000_000) {
    throw new Error('充值金额应为 0.01 至 1000000 元')
  }
  return fen
}

export function resolveRechargeAmountFen(
  selectedFen: number | null,
  customAmount: string
): number {
  if (customAmount.trim()) {
    return parseRechargeAmountFen(customAmount)
  }
  if (selectedFen !== null) return selectedFen
  throw new Error('请选择或输入充值金额')
}
