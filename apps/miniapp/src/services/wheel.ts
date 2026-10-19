export type WheelItem = { id: number; name: string; count: number }
export const wheelColors = ['#b8dfce', '#f4d490', '#bad8ee', '#edbeb5', '#d1c3e6', '#cddc9e']

export function wheelSlots(items: readonly WheelItem[]): number[] {
  if (!items.length || items.some(item => !item.name.trim() || !Number.isSafeInteger(item.count) || item.count < 1)) {
    throw new Error('请填写项目名称，数量须为正整数')
  }
  const total = items.reduce((sum, item) => sum + item.count, 0)
  if (total > 60) throw new Error('转盘最多支持 60 格')
  return items.flatMap(item => Array.from({ length: item.count }, () => item.id))
}

// Each copy occupies one equal sector; the fixed pointer is at twelve o'clock.
export function wheelStopAngle(current: number, slot: number, total: number): number {
  const target = (360 - (slot + 0.5) * 360 / total) % 360
  return current + 1080 + ((target - current % 360 + 360) % 360)
}
