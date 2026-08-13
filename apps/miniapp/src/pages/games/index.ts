import type {
  BoardGameSourceAttribution,
  PublicBoardGameFilters,
  PublicBoardGameSummary
} from '@zyapp/contracts'
import {
  cleanBoardGameFilters,
  groupBoardGames,
  toBoardGameCardView,
  withLikeResult,
  type BoardGameCardView,
  type BoardGameListView
} from '../../services/board-game-library'
import { getMiniappClient } from '../../services/client'

type RangeValue = { lower: number; upper: number }
type RangeBounds = { min: number; max: number; step: number }
type RangeEvent = { detail: RangeValue }
type CategoryEvent = { detail: { value: string[] } }
type GameEvent = { detail: { gameId: string } }

type CategoryView = { name: string; selected: boolean }
type FilterChip = {
  key: string
  label: string
  kind: 'category' | 'players' | 'minutes' | 'complexity'
  category?: string
}

let loadSequence = 0
let previewSequence = 0
let previewTimer: ReturnType<typeof setTimeout> | null = null

const defaultPlayerBounds: RangeBounds = { min: 1, max: 8, step: 1 }
const defaultMinuteBounds: RangeBounds = { min: 15, max: 240, step: 5 }
const defaultComplexityBounds: RangeBounds = { min: 0, max: 5, step: 0.1 }

function requestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function values(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null)
}

function bounds(games: PublicBoardGameSummary[]): {
  players: RangeBounds
  minutes: RangeBounds
  complexity: RangeBounds
} {
  const playerMinimums = games.map((game) => game.minPlayers)
  const playerMaximums = games.map((game) => game.maxPlayers)
  const minuteMinimums = values(games.map((game) => game.minMinutes))
  const minuteMaximums = values(
    games.map((game) => game.maxMinutes ?? game.minMinutes)
  )
  const complexities = values(games.map((game) => game.complexityRating))
  return {
    players:
      games.length === 0
        ? defaultPlayerBounds
        : {
            min: Math.min(...playerMinimums),
            max: Math.max(...playerMaximums),
            step: 1
          },
    minutes:
      minuteMinimums.length === 0
        ? defaultMinuteBounds
        : {
            min: Math.min(...minuteMinimums),
            max: Math.max(...minuteMaximums),
            step: 5
          },
    complexity:
      complexities.length === 0
        ? defaultComplexityBounds
        : {
            min: Math.min(...complexities),
            max: Math.max(...complexities),
            step: 0.1
          }
  }
}

function categoryViews(
  options: string[],
  selected: string[]
): CategoryView[] {
  const selectedSet = new Set(selected)
  return options.map((name) => ({ name, selected: selectedSet.has(name) }))
}

function chips(filters: PublicBoardGameFilters): FilterChip[] {
  const result: FilterChip[] = (filters.categories ?? []).map((category) => ({
    key: `category:${category}`,
    label: category,
    kind: 'category',
    category
  }))
  if (filters.minPlayers !== undefined || filters.maxPlayers !== undefined) {
    result.push({
      key: 'players',
      label: `${filters.minPlayers}–${filters.maxPlayers} 人`,
      kind: 'players'
    })
  }
  if (filters.minMinutes !== undefined || filters.maxMinutes !== undefined) {
    result.push({
      key: 'minutes',
      label: `${filters.minMinutes}–${filters.maxMinutes} 分钟`,
      kind: 'minutes'
    })
  }
  if (
    filters.minComplexity !== undefined ||
    filters.maxComplexity !== undefined
  ) {
    result.push({
      key: 'complexity',
      label: `${filters.minComplexity}–${filters.maxComplexity} / 5`,
      kind: 'complexity'
    })
  }
  return result
}

Page({
  data: {
    query: '',
    games: [] as BoardGameListView[],
    resultCount: 0,
    sourceAttribution: null as BoardGameSourceAttribution | null,
    loading: true,
    loadFailed: false,
    filterOpen: false,
    appliedFilters: {} as PublicBoardGameFilters,
    selectedChips: [] as FilterChip[],
    categoryOptions: [] as string[],
    categoryViews: [] as CategoryView[],
    draftCategories: [] as string[],
    playerBounds: defaultPlayerBounds,
    minuteBounds: defaultMinuteBounds,
    complexityBounds: defaultComplexityBounds,
    draftPlayers: {
      lower: defaultPlayerBounds.min,
      upper: defaultPlayerBounds.max
    } as RangeValue,
    draftMinutes: {
      lower: defaultMinuteBounds.min,
      upper: defaultMinuteBounds.max
    } as RangeValue,
    draftComplexity: {
      lower: defaultComplexityBounds.min,
      upper: defaultComplexityBounds.max
    } as RangeValue,
    previewCount: 0,
    previewLoading: false
  },

  onShow() {
    void this.loadGames()
  },

  onUnload() {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = null
  },

  requestFilters(): PublicBoardGameFilters {
    return cleanBoardGameFilters({
      ...this.data.appliedFilters,
      query: this.data.query
    })
  },

  draftFilters(): PublicBoardGameFilters {
    const filters: PublicBoardGameFilters = {
      query: this.data.query,
      categories: this.data.draftCategories
    }
    if (
      this.data.draftPlayers.lower !== this.data.playerBounds.min ||
      this.data.draftPlayers.upper !== this.data.playerBounds.max
    ) {
      filters.minPlayers = this.data.draftPlayers.lower
      filters.maxPlayers = this.data.draftPlayers.upper
    }
    if (
      this.data.draftMinutes.lower !== this.data.minuteBounds.min ||
      this.data.draftMinutes.upper !== this.data.minuteBounds.max
    ) {
      filters.minMinutes = this.data.draftMinutes.lower
      filters.maxMinutes = this.data.draftMinutes.upper
    }
    if (
      this.data.draftComplexity.lower !== this.data.complexityBounds.min ||
      this.data.draftComplexity.upper !== this.data.complexityBounds.max
    ) {
      filters.minComplexity = this.data.draftComplexity.lower
      filters.maxComplexity = this.data.draftComplexity.upper
    }
    return cleanBoardGameFilters(filters)
  },

  async loadGames(filters?: PublicBoardGameFilters) {
    const sequence = ++loadSequence
    this.setData({ loading: true })
    try {
      const result = await getMiniappClient().listGames(
        filters ?? this.requestFilters()
      )
      if (sequence !== loadSequence) return
      const previousCards = this.data.games.flatMap((game) => [
        game,
        ...game.expansions
      ])
      const existing = new Map(previousCards.map((game) => [game.id, game]))
      const expandedBaseGameIds = new Set(
        this.data.games
          .filter((game) => game.expansionsExpanded)
          .map((game) => game.id)
      )
      const cards = result.map((game) => {
        const previous = existing.get(game.id)
        return toBoardGameCardView(game, {
          expanded: previous?.expanded ?? false,
          likeBusy: false,
          imageFailed: previous?.imageFailed ?? false
        })
      })
      const games = groupBoardGames(cards, expandedBaseGameIds)
      const patch: Record<string, unknown> = {
        games,
        resultCount: result.length,
        sourceAttribution:
          result.find((game) => game.sourceAttribution !== null)
            ?.sourceAttribution ?? null,
        loadFailed: false,
        previewCount: result.length
      }
      if (this.data.categoryOptions.length === 0 && result.length > 0) {
        const rangeBounds = bounds(result)
        const categoryOptions = [
          ...new Set(result.flatMap((game) => game.categories))
        ].sort((left, right) => left.localeCompare(right, 'zh-CN'))
        Object.assign(patch, {
          categoryOptions,
          categoryViews: categoryViews(categoryOptions, []),
          playerBounds: rangeBounds.players,
          minuteBounds: rangeBounds.minutes,
          complexityBounds: rangeBounds.complexity,
          draftPlayers: {
            lower: rangeBounds.players.min,
            upper: rangeBounds.players.max
          },
          draftMinutes: {
            lower: rangeBounds.minutes.min,
            upper: rangeBounds.minutes.max
          },
          draftComplexity: {
            lower: rangeBounds.complexity.min,
            upper: rangeBounds.complexity.max
          }
        })
      }
      this.setData(patch)
    } catch (error) {
      if (sequence !== loadSequence) return
      this.setData({ loadFailed: true })
      wx.showToast({
        title: error instanceof Error ? error.message : '桌游加载失败',
        icon: 'none'
      })
    } finally {
      if (sequence === loadSequence) this.setData({ loading: false })
    }
  },

  onQueryInput(event: { detail: { value: string } }) {
    this.setData({ query: event.detail.value })
  },

  search() {
    void this.loadGames()
  },

  retry() {
    void this.loadGames()
  },

  openFilter() {
    const filters = this.data.appliedFilters
    const draftCategories = [...(filters.categories ?? [])]
    this.setData({
      filterOpen: true,
      draftCategories,
      categoryViews: categoryViews(this.data.categoryOptions, draftCategories),
      draftPlayers: {
        lower: filters.minPlayers ?? this.data.playerBounds.min,
        upper: filters.maxPlayers ?? this.data.playerBounds.max
      },
      draftMinutes: {
        lower: filters.minMinutes ?? this.data.minuteBounds.min,
        upper: filters.maxMinutes ?? this.data.minuteBounds.max
      },
      draftComplexity: {
        lower: filters.minComplexity ?? this.data.complexityBounds.min,
        upper: filters.maxComplexity ?? this.data.complexityBounds.max
      }
    })
    this.schedulePreview()
  },

  closeFilter() {
    this.setData({ filterOpen: false })
  },

  noop() {},

  changeCategories(event: CategoryEvent) {
    const draftCategories = event.detail.value
    this.setData({
      draftCategories,
      categoryViews: categoryViews(this.data.categoryOptions, draftCategories)
    })
    this.schedulePreview()
  },

  changePlayers(event: RangeEvent) {
    this.setData({ draftPlayers: event.detail })
    this.schedulePreview()
  },

  changeMinutes(event: RangeEvent) {
    this.setData({ draftMinutes: event.detail })
    this.schedulePreview()
  },

  changeComplexity(event: RangeEvent) {
    this.setData({ draftComplexity: event.detail })
    this.schedulePreview()
  },

  schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer)
    this.setData({ previewLoading: true })
    previewTimer = setTimeout(() => void this.loadPreview(), 200)
  },

  async loadPreview() {
    const sequence = ++previewSequence
    try {
      const result = await getMiniappClient().listGames(this.draftFilters())
      if (sequence === previewSequence) {
        this.setData({ previewCount: result.length })
      }
    } catch {
      if (sequence === previewSequence) {
        wx.showToast({ title: '筛选预览失败，请重试', icon: 'none' })
      }
    } finally {
      if (sequence === previewSequence) this.setData({ previewLoading: false })
    }
  },

  clearDraft() {
    this.setData({
      draftCategories: [],
      categoryViews: categoryViews(this.data.categoryOptions, []),
      draftPlayers: {
        lower: this.data.playerBounds.min,
        upper: this.data.playerBounds.max
      },
      draftMinutes: {
        lower: this.data.minuteBounds.min,
        upper: this.data.minuteBounds.max
      },
      draftComplexity: {
        lower: this.data.complexityBounds.min,
        upper: this.data.complexityBounds.max
      }
    })
    this.schedulePreview()
  },

  applyFilters() {
    const { query: _query, ...appliedFilters } = this.draftFilters()
    this.setData({
      appliedFilters,
      selectedChips: chips(appliedFilters),
      filterOpen: false
    })
    void this.loadGames(
      cleanBoardGameFilters({ ...appliedFilters, query: this.data.query })
    )
  },

  removeChip(event: {
    currentTarget: {
      dataset: { kind?: FilterChip['kind']; category?: string }
    }
  }) {
    const kind = event.currentTarget.dataset.kind
    const filters = { ...this.data.appliedFilters }
    if (kind === 'category') {
      filters.categories = (filters.categories ?? []).filter(
        (category) => category !== event.currentTarget.dataset.category
      )
    } else if (kind === 'players') {
      delete filters.minPlayers
      delete filters.maxPlayers
    } else if (kind === 'minutes') {
      delete filters.minMinutes
      delete filters.maxMinutes
    } else if (kind === 'complexity') {
      delete filters.minComplexity
      delete filters.maxComplexity
    }
    const appliedFilters = cleanBoardGameFilters(filters)
    this.setData({
      appliedFilters,
      selectedChips: chips(appliedFilters)
    })
    void this.loadGames(
      cleanBoardGameFilters({ ...appliedFilters, query: this.data.query })
    )
  },

  clearAll() {
    this.setData({ query: '', appliedFilters: {}, selectedChips: [] })
    void this.loadGames({})
  },

  copyBggSource() {
    const attribution = this.data.sourceAttribution
    if (!attribution) return
    wx.setClipboardData({
      data: attribution.url,
      success: () => {
        wx.showToast({ title: 'BGG 来源链接已复制', icon: 'none' })
      }
    })
  },

  toggleGame(event: GameEvent) {
    const gameId = event.detail.gameId
    this.setData({
      games: this.data.games.map((game) =>
        game.id === gameId && game.expansionCount > 0
          ? { ...game, expansionsExpanded: !game.expansionsExpanded }
          : game.id === gameId
            ? { ...game, expanded: !game.expanded }
            : {
                ...game,
                expansions: game.expansions.map((expansion) =>
                  expansion.id === gameId
                    ? { ...expansion, expanded: !expansion.expanded }
                    : expansion
                )
              }
      )
    })
  },

  toggleExpansions(event: {
    currentTarget: { dataset: { gameId?: string } }
  }) {
    const gameId = event.currentTarget.dataset.gameId
    if (!gameId) return
    this.setData({
      games: this.data.games.map((game) =>
        game.id === gameId
          ? { ...game, expansionsExpanded: !game.expansionsExpanded }
          : game
      )
    })
  },

  imageError(event: GameEvent) {
    const gameId = event.detail.gameId
    this.setData({
      games: this.data.games.map((game) =>
        game.id === gameId
          ? { ...game, imageFailed: true }
          : {
              ...game,
              expansions: game.expansions.map((expansion) =>
                expansion.id === gameId
                  ? { ...expansion, imageFailed: true }
                  : expansion
              )
            }
      )
    })
  },

  async likeGame(event: GameEvent) {
    const gameId = event.detail.gameId
    const flatGames = this.data.games.flatMap((game) => [game, ...game.expansions])
    const original = flatGames.find((game) => game.id === gameId)
    if (!original || original.likeBusy) return
    const liked = !original.likedByViewer
    this.setData({
      games: this.data.games.map((game) => {
        const update = (card: BoardGameCardView): BoardGameCardView =>
          card.id === gameId
            ? {
                ...card,
                likedByViewer: liked,
                likeCount: Math.max(0, card.likeCount + (liked ? 1 : -1)),
                likeBusy: true
              }
            : card
        return {
          ...game,
          ...update(game),
          expansionsExpanded: game.expansionsExpanded,
          expansions: game.expansions.map(update)
        }
      })
    })
    try {
      const result = await getMiniappClient().setGameLiked(gameId, {
        liked,
        requestId: requestId('board-game-like')
      })
      this.setData({
        games: this.data.games.map((game) => ({
          ...withLikeResult([game], result)[0] as BoardGameListView,
          expansions: withLikeResult(game.expansions, result)
        }))
      })
    } catch {
      this.setData({
        games: this.data.games.map((game) => ({
          ...(game.id === gameId ? { ...game, ...original, likeBusy: false } : game),
          expansions: game.expansions.map((expansion) =>
            expansion.id === gameId ? { ...original, likeBusy: false } : expansion
          )
        }))
      })
      wx.showToast({ title: '操作失败，请重试', icon: 'none' })
    }
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/index' })
  },
  goGames() {},
  goHistory() {
    wx.reLaunch({ url: '/pages/history/index' })
  },
  goProfile() {
    wx.reLaunch({ url: '/pages/member/index?mode=edit' })
  }
})
