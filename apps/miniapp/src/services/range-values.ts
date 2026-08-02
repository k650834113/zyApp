export type RangeHandle = 'lower' | 'upper'

type RangeInput = {
  min: number
  max: number
  step: number
  lower: number
  upper: number
}

type PositionInput = {
  x: number
  left: number
  width: number
  min: number
  max: number
  step: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function precision(step: number): number {
  const text = String(step)
  return text.includes('.') ? (text.split('.')[1]?.length ?? 0) : 0
}

function roundToStep(
  value: number,
  minimum: number,
  step: number
): number {
  const rounded = minimum + Math.round((value - minimum) / step) * step
  return Number(rounded.toFixed(precision(step)))
}

export function normalizeRange(input: RangeInput): {
  lower: number
  upper: number
} {
  const minimum = Math.min(input.min, input.max)
  const maximum = Math.max(input.min, input.max)
  const step = input.step > 0 ? input.step : 1
  const first = clamp(
    roundToStep(input.lower, minimum, step),
    minimum,
    maximum
  )
  const second = clamp(
    roundToStep(input.upper, minimum, step),
    minimum,
    maximum
  )
  return {
    lower: Math.min(first, second),
    upper: Math.max(first, second)
  }
}

export function valueFromPosition(input: PositionInput): number {
  if (input.width <= 0) return input.min
  const ratio = clamp((input.x - input.left) / input.width, 0, 1)
  const raw = input.min + ratio * (input.max - input.min)
  return clamp(
    roundToStep(raw, input.min, input.step > 0 ? input.step : 1),
    input.min,
    input.max
  )
}

export function nearestHandle(
  value: number,
  lower: number,
  upper: number,
  active: RangeHandle
): RangeHandle {
  const lowerDistance = Math.abs(value - lower)
  const upperDistance = Math.abs(value - upper)
  if (lowerDistance === upperDistance) return active
  return lowerDistance < upperDistance ? 'lower' : 'upper'
}
