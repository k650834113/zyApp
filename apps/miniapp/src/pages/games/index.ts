import type {
  BoardGameSourceAttribution,
  PublicBoardGameFilters
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
import { createShareAppMessage } from '../../services/share'

type RangeValue = { lower: number; upper: number }
type RangeBounds = { min: number; max: number; step: number }
type RangeEvent = { detail: RangeValue }
type CategoryEvent = { detail: { value: string[] } }
type GameEvent = { detail: { gameId: string } }
type ExpansionEvent = { detail: { gameId: string; gameName: string } }
type FilterKind = 'category' | 'players' | 'minutes' | 'complexity'
type FilterEvent = { currentTarget: { dataset: { filterKind?: FilterKind } } }
type SortValue = NonNullable<PublicBoardGameFilters['sort']>
type SortEvent = { currentTarget: { dataset: { sort?: SortValue } } }

type CategoryView = { name: string; selected: boolean }
type FilterChip = {
  key: string
  label: string
  kind: 'category' | 'players' | 'minutes' | 'complexity'
  category?: string
}

let loadSequence = 0

const PAGE_SIZE = 24
const COMMON_CATEGORY_LIMIT = 12

const defaultPlayerBounds: RangeBounds = { min: 1, max: 8, step: 1 }
const defaultMinuteBounds: RangeBounds = { min: 15, max: 240, step: 5 }
const defaultComplexityBounds: RangeBounds = { min: 0, max: 5, step: 0.1 }

function requestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function categoryViews(
  options: string[],
  selected: string[]
): CategoryView[] {
  const selectedSet = new Set(selected)
  return options.map((name) => ({ name, selected: selectedSet.has(name) }))
}

function visibleCategories(options: string[], query: string): string[] {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  if (!normalized) return options.slice(0, COMMON_CATEGORY_LIMIT)
  return options
    .filter((category) =>
      category.toLocaleLowerCase('zh-CN').includes(normalized)
    )
    .slice(0, 30)
}

function discoveredCategories(games: BoardGameCardView[]): string[] {
  const counts = new Map<string, number>()
  for (const game of games) {
    for (const category of new Set(game.categories)) {
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
  }
  return [...counts]
    .sort(
      ([left, leftCount], [right, rightCount]) =>
        rightCount - leftCount || left.localeCompare(right, 'zh-CN')
    )
    .map(([category]) => category)
}

function decodedCategory(value: string | undefined): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value).trim()
  } catch {
    return value.trim()
  }
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
  onShareAppMessage() {
    return createShareAppMessage('桌游库')
  },

  data: {
    query: '',
    games: [] as BoardGameListView[],
    sort: 'recent' as SortValue,
    sortLabel: '最近更新',
    sortOpen: false,
    sourceAttribution: null as BoardGameSourceAttribution | null,
    loading: true,
    loadingMore: false,
    hasMore: true,
    loadFailed: false,
    filterOpen: false,
    activeFilter: 'category' as FilterKind,
    filterTitle: '按分类筛选',
    appliedFilters: {} as PublicBoardGameFilters,
    selectedChips: [] as FilterChip[],
    allCategoryOptions: [] as string[],
    categoryOptions: [] as string[],
    categoryViews: [] as CategoryView[],
    categoryQuery: '',
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
    } as RangeValue
  },

  onLoad(options: { category?: string }) {
    const category = decodedCategory(options.category)
    const appliedFilters: PublicBoardGameFilters = category
      ? { categories: [category] }
      : {}
    this.setData({
      appliedFilters,
      selectedChips: chips(appliedFilters),
      draftCategories: appliedFilters.categories ?? []
    })
    void this.loadGames(appliedFilters)
    if (this.data.allCategoryOptions.length === 0) {
      void this.loadFilterOptions()
    }
  },

  onReachBottom() {
    void this.loadMore()
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

  async loadFilterOptions() {
    try {
      const options = await getMiniappClient().getGameFilterOptions()
      const categoryOptions = visibleCategories(options.categories, '')
      const selectedCategories = this.data.appliedFilters.categories ?? []
      const playerBounds = { ...options.playerBounds, step: 1 }
      const minuteBounds = { ...options.minuteBounds, step: 5 }
      const complexityBounds = { ...options.complexityBounds, step: 0.1 }
      this.setData({
        allCategoryOptions: options.categories,
        categoryOptions,
        categoryViews: categoryViews(categoryOptions, selectedCategories),
        playerBounds,
        minuteBounds,
        complexityBounds,
        draftPlayers: {
          lower: playerBounds.min,
          upper: playerBounds.max
        },
        draftMinutes: {
          lower: minuteBounds.min,
          upper: minuteBounds.max
        },
        draftComplexity: {
          lower: complexityBounds.min,
          upper: complexityBounds.max
        }
      })
    } catch {
      wx.showToast({ title: '筛选项加载失败，请重试', icon: 'none' })
    }
  },

  async loadGames(filters?: PublicBoardGameFilters, append = false) {
    const sequence = ++loadSequence
    const previousCards = this.data.games.flatMap((game) => [
      game,
      ...game.expansions
    ])
    const offset = append ? previousCards.length : 0
    this.setData(append ? { loadingMore: true } : { loading: true })
    try {
      const result = await getMiniappClient().listGames(
        cleanBoardGameFilters({
          ...(filters ?? this.requestFilters()),
          sort: this.data.sort,
          limit: PAGE_SIZE,
          offset
        })
      )
      if (sequence !== loadSequence) return
      const existing = new Map(previousCards.map((game) => [game.id, game]))
      const expandedBaseGameIds = new Set(
        this.data.games
          .filter((game) => game.expansionsExpanded)
          .map((game) => game.id)
      )
      const nextCards = result.map((game) => {
        const previous = existing.get(game.id)
        return toBoardGameCardView(game, {
          expanded: previous?.expanded ?? false,
          likeBusy: false,
          imageFailed: previous?.imageFailed ?? false
        })
      })
      const cards = append
        ? [
            ...new Map(
              [...previousCards, ...nextCards].map((game) => [game.id, game])
            ).values()
          ]
        : nextCards
      const games = groupBoardGames(cards, expandedBaseGameIds)
      const fallbackCategories =
        this.data.allCategoryOptions.length === 0
          ? discoveredCategories(cards)
          : this.data.allCategoryOptions
      const fallbackCategoryOptions = visibleCategories(
        fallbackCategories,
        this.data.categoryQuery
      )
      this.setData({
        games,
        hasMore: result.length === PAGE_SIZE,
        sourceAttribution:
          cards.find((game) => game.sourceAttribution !== null)
            ?.sourceAttribution ?? null,
        loadFailed: false,
        ...(this.data.allCategoryOptions.length === 0
          ? {
              allCategoryOptions: fallbackCategories,
              categoryOptions: fallbackCategoryOptions,
              categoryViews: categoryViews(
                fallbackCategoryOptions,
                this.data.draftCategories
              )
            }
          : {})
      })
    } catch (error) {
      if (sequence !== loadSequence) return
      if (!append) this.setData({ loadFailed: true })
      wx.showToast({
        title:
          error instanceof Error
            ? error.message
            : append
              ? '加载更多失败'
              : '桌游加载失败',
        icon: 'none'
      })
    } finally {
      if (sequence === loadSequence) {
        this.setData(append ? { loadingMore: false } : { loading: false })
      }
    }
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return
    return this.loadGames(this.requestFilters(), true)
  },

  onQueryInput(event: { detail: { value: string } }) {
    this.setData({ query: event.detail.value })
  },

  search() {
    void this.loadGames()
  },

  toggleSort() {
    this.setData({ sortOpen: !this.data.sortOpen })
  },

  closeSort() {
    this.setData({ sortOpen: false })
  },

  changeSort(event: SortEvent) {
    const sort = event.currentTarget.dataset.sort
    if (!sort) return
    if (sort === this.data.sort) {
      this.closeSort()
      return
    }
    this.setData(
      {
        sort,
        sortLabel: sort === 'recent' ? '最近更新' : '最多喜爱',
        sortOpen: false,
        games: [],
        hasMore: true,
        loadFailed: false,
        loadingMore: false,
        sourceAttribution: null
      },
      () => {
        wx.pageScrollTo({ scrollTop: 0, duration: 0 })
        void this.loadGames(this.requestFilters())
      }
    )
  },

  retry() {
    void this.loadGames()
  },

  openFilter(event: FilterEvent) {
    const activeFilter = event.currentTarget.dataset.filterKind ?? 'category'
    const filterTitles: Record<FilterKind, string> = {
      category: '按分类筛选',
      players: '按人数筛选',
      minutes: '按时长筛选',
      complexity: '按复杂度筛选'
    }
    const filters = this.data.appliedFilters
    const draftCategories = [...(filters.categories ?? [])]
    const categoryOptions = visibleCategories(this.data.allCategoryOptions, '')
    this.setData({
      filterOpen: true,
      sortOpen: false,
      activeFilter,
      filterTitle: filterTitles[activeFilter],
      draftCategories,
      categoryQuery: '',
      categoryOptions,
      categoryViews: categoryViews(categoryOptions, draftCategories),
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
  },

  closeFilter() {
    this.setData({ filterOpen: false })
  },

  noop() {},

  changeCategories(event: CategoryEvent) {
    const visible = new Set(this.data.categoryOptions)
    const hiddenSelections = this.data.draftCategories.filter(
      (category) => !visible.has(category)
    )
    const draftCategories = [
      ...new Set([...hiddenSelections, ...event.detail.value])
    ]
    this.setData({
      draftCategories,
      categoryViews: categoryViews(this.data.categoryOptions, draftCategories)
    })
  },

  onCategoryQueryInput(event: { detail: { value: string } }) {
    const categoryQuery = event.detail.value
    const categoryOptions = visibleCategories(
      this.data.allCategoryOptions,
      categoryQuery
    )
    this.setData({
      categoryQuery,
      categoryOptions,
      categoryViews: categoryViews(categoryOptions, this.data.draftCategories)
    })
  },

  changePlayers(event: RangeEvent) {
    this.setData({ draftPlayers: event.detail })
  },

  changeMinutes(event: RangeEvent) {
    this.setData({ draftMinutes: event.detail })
  },

  changeComplexity(event: RangeEvent) {
    this.setData({ draftComplexity: event.detail })
  },

  clearDraft() {
    const categoryOptions = visibleCategories(this.data.allCategoryOptions, '')
    this.setData({
      draftCategories: [],
      categoryQuery: '',
      categoryOptions,
      categoryViews: categoryViews(categoryOptions, []),
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
        game.id === gameId
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

  goExpansions(event: ExpansionEvent) {
    const { gameId, gameName } = event.detail
    wx.navigateTo({
      url:
        `/pages/game-expansions/index?baseGameId=${encodeURIComponent(gameId)}` +
        `&baseGameName=${encodeURIComponent(gameName)}`
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
  goTools() {
    wx.reLaunch({ url: '/pages/tools/index' })
  },
  goHistory() {
    wx.reLaunch({ url: '/pages/history/index' })
  },
  goProfile() {
    wx.reLaunch({ url: '/pages/member/index?mode=edit' })
  }
})
