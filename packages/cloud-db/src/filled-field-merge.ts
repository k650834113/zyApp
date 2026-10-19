// Only descriptive data can use fill-empty merging. IDs, privileges, prices,
// balances, counters and lifecycle flags require their normal validation.
const fields: Record<string, Set<string>> = {
  member: new Set(['nickname', 'note', 'avatarUrl']),
  store: new Set(['name', 'address', 'contactPhone']),
  announcement: new Set(['title', 'content']),
  activity: new Set(['title', 'summary', 'content']),
  catalog: new Set(['name', 'note']),
  board_game: new Set(['name', 'introduction', 'coverUrl', 'tags', 'customerNote', 'internalNote', 'consignorNickname'])
}
function empty(value: unknown): boolean {
  return value === null || value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
}
export function canMergeFilledField(type: string, field: string, cloud: unknown, local: unknown): boolean {
  return fields[type]?.has(field) === true && (empty(cloud) || empty(local))
}
export function mergeFilledField(cloud: unknown, local: unknown): unknown {
  return empty(local) ? cloud : local
}
