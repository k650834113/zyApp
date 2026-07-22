const FEN_PER_YUAN = 100

export type Fen = number & { readonly __brand: 'Fen' }

export function fen(value: number): Fen {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError('Money must be a safe integer number of fen')
  }

  return value as Fen
}
export function nonNegativeFen(value: number): Fen {
  const amount = fen(value)
  if (amount < 0) {
    throw new RangeError('Money must not be negative')
  }

  return amount
}

export function yuanToFen(value: string): Fen {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new TypeError('Yuan amount must contain at most two decimal places')
  }

  const [yuanPart, decimalPart = ''] = value.split('.')
  const yuan = Number(yuanPart)
  const decimals = Number(decimalPart.padEnd(2, '0'))

  return nonNegativeFen(yuan * FEN_PER_YUAN + decimals)
}

export function formatFen(value: Fen): string {
  const sign = value < 0 ? '-' : ''
  const absolute = Math.abs(value)
  return `${sign}${Math.floor(absolute / FEN_PER_YUAN)}.${String(absolute % FEN_PER_YUAN).padStart(2, '0')}`
}
