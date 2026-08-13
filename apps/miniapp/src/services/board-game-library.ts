import type {
  BoardGameLikeResult,
  PublicBoardGameFilters,
  PublicBoardGameSummary
} from '@zyapp/contracts'

export type BoardGameCardView = PublicBoardGameSummary & {
  playersText: string
  durationText: string
  complexityText: string
  expanded: boolean
  likeBusy: boolean
  imageFailed: boolean
  isExpansion: boolean
  expansionCount: number
}

export type BoardGameListView = BoardGameCardView & {
  expansions: BoardGameCardView[]
  expansionsExpanded: boolean
}

export function cleanBoardGameFilters(
  filters: PublicBoardGameFilters
): PublicBoardGameFilters {
  const query = filters.query?.trim()
  const categories = filters.categories
    ?.map((category) => category.trim())
    .filter(Boolean)
  return {
    ...(query ? { query } : {}),
    ...(categories?.length ? { categories: [...new Set(categories)] } : {}),
    ...(filters.minPlayers === undefined
      ? {}
      : { minPlayers: filters.minPlayers }),
    ...(filters.maxPlayers === undefined
      ? {}
      : { maxPlayers: filters.maxPlayers }),
    ...(filters.minMinutes === undefined
      ? {}
      : { minMinutes: filters.minMinutes }),
    ...(filters.maxMinutes === undefined
      ? {}
      : { maxMinutes: filters.maxMinutes }),
    ...(filters.minComplexity === undefined
      ? {}
      : { minComplexity: filters.minComplexity }),
    ...(filters.maxComplexity === undefined
      ? {}
      : { maxComplexity: filters.maxComplexity })
  }
}

export function matchesBoardGameFilters(
  game: PublicBoardGameSummary,
  rawFilters: PublicBoardGameFilters
): boolean {
  const filters = cleanBoardGameFilters(rawFilters)
  const query = filters.query?.toLowerCase()
  if (
    query &&
    !game.name.toLowerCase().includes(query) &&
    !game.categories.some((category) =>
      category.toLowerCase().includes(query)
    )
  ) {
    return false
  }
  if (
    filters.categories?.some(
      (category) => !game.categories.includes(category)
    )
  ) {
    return false
  }
  if (
    filters.minPlayers !== undefined &&
    game.minPlayers > filters.minPlayers
  ) {
    return false
  }
  if (
    filters.maxPlayers !== undefined &&
    game.maxPlayers < filters.maxPlayers
  ) {
    return false
  }
  if (
    filters.minMinutes !== undefined ||
    filters.maxMinutes !== undefined
  ) {
    if (game.minMinutes === null) return false
    const gameMaximum = game.maxMinutes ?? game.minMinutes
    if (
      filters.minMinutes !== undefined &&
      gameMaximum < filters.minMinutes
    ) {
      return false
    }
    if (
      filters.maxMinutes !== undefined &&
      game.minMinutes > filters.maxMinutes
    ) {
      return false
    }
  }
  if (
    filters.minComplexity !== undefined ||
    filters.maxComplexity !== undefined
  ) {
    if (game.complexityRating === null) return false
    if (
      filters.minComplexity !== undefined &&
      game.complexityRating < filters.minComplexity
    ) {
      return false
    }
    if (
      filters.maxComplexity !== undefined &&
      game.complexityRating > filters.maxComplexity
    ) {
      return false
    }
  }
  return true
}

export function toBoardGameCardView(
  game: PublicBoardGameSummary,
  state: Partial<
    Pick<BoardGameCardView, 'expanded' | 'likeBusy' | 'imageFailed'>
  > = {}
): BoardGameCardView {
  return {
    ...game,
    playersText: `${game.minPlayers}–${game.maxPlayers} 人`,
    durationText:
      game.minMinutes === null
        ? '时长待补充'
        : `${game.minMinutes}–${game.maxMinutes ?? game.minMinutes} 分钟`,
    complexityText:
      game.complexityRating === null
        ? '复杂度待补充'
        : `复杂度 ${game.complexityRating.toFixed(1)}/5`,
    expanded: state.expanded ?? false,
    likeBusy: state.likeBusy ?? false,
    imageFailed: state.imageFailed ?? false,
    isExpansion: game.baseGameId !== null,
    expansionCount: 0
  }
}

export function groupBoardGames(
  games: BoardGameCardView[],
  expandedBaseGameIds: ReadonlySet<string> = new Set()
): BoardGameListView[] {
  const children = new Map<string, BoardGameCardView[]>()
  for (const game of games) {
    if (!game.baseGameId) continue
    const current = children.get(game.baseGameId) ?? []
    current.push(game)
    children.set(game.baseGameId, current)
  }
  const visibleIds = new Set(games.map((game) => game.id))
  return games
    .filter((game) =>
      game.baseGameId === null || !visibleIds.has(game.baseGameId)
    )
    .map((game) => {
      const expansions = children.get(game.id) ?? []
      return {
        ...game,
        expansionCount: expansions.length,
        expansions,
        expansionsExpanded: expandedBaseGameIds.has(game.id)
      }
    })
}

export function withLikeResult(
  games: BoardGameCardView[],
  result: BoardGameLikeResult
): BoardGameCardView[] {
  return games.map((game) =>
    game.id === result.boardGameId
      ? {
          ...game,
          likedByViewer: result.likedByViewer,
          likeCount: result.likeCount,
          likeBusy: false
        }
      : game
  )
}
