import type { PublicBoardGameSummary } from '@zyapp/contracts'

// Bounded in-memory navigation context, populated only with already-loaded games.
const recent = new Map<string, PublicBoardGameSummary>()
export function rememberGameDetail(game: PublicBoardGameSummary): void {
  recent.delete(game.id)
  recent.set(game.id, game)
  if (recent.size > 30) {
    const oldest = recent.keys().next().value
    if (oldest) recent.delete(oldest)
  }
}
export function getGameDetailContext(id: string): PublicBoardGameSummary | null {
  return recent.get(id) ?? null
}
