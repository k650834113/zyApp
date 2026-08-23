import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('board-game library exposes the approved search and filter controls', () => {
  const wxml = source('../src/pages/games/index.wxml')
  const page = source('../src/pages/games/index.ts')

  assert.match(wxml, /placeholder="搜索桌游名称"/)
  assert.match(wxml, /placeholder="搜索标签"/)
  assert.match(wxml, /bindinput="onCategoryQueryInput"/)
  assert.match(wxml, /继续下滑加载更多/)
  assert.match(wxml, /show-expansion-action="{{true}}"/)
  assert.match(wxml, /bindviewexpansions="goExpansions"/)
  assert.match(wxml, /data-filter-kind="category"[^>]+bindtap="openFilter"/)
  assert.match(wxml, /data-filter-kind="players"[^>]+bindtap="openFilter"/)
  assert.match(wxml, /data-filter-kind="minutes"[^>]+bindtap="openFilter"/)
  assert.match(wxml, /data-filter-kind="complexity"[^>]+bindtap="openFilter"/)
  assert.match(wxml, /wx:if="{{activeFilter === 'category'}}"/)
  assert.match(wxml, /wx:if="{{activeFilter === 'players'}}"/)
  assert.match(wxml, /wx:if="{{activeFilter === 'minutes'}}"/)
  assert.match(wxml, /wx:if="{{activeFilter === 'complexity'}}"/)
  assert.match(wxml, /<checkbox-group[^>]+bindchange="changeCategories"/s)
  assert.match(wxml, /<range-slider[^>]+bindchange="changePlayers"/s)
  assert.match(wxml, /<range-slider[^>]+bindchange="changeMinutes"/s)
  assert.match(wxml, /<range-slider[^>]+bindchange="changeComplexity"/s)
  assert.match(wxml, /应用筛选/)
  assert.match(wxml, /<board-game-card/)
  assert.match(wxml, /id="game-card-{{index}}"/)
  assert.match(wxml, /没有找到符合条件的桌游/)
  assert.match(wxml, /加载失败，点击重试/)
  assert.doesNotMatch(wxml, /已展示 \{\{resultCount\}\} 款桌游/)
  assert.match(wxml, /class="sort-trigger[^>]+bindtap="toggleSort"/)
  assert.match(wxml, /class="sort-scrim" bindtap="closeSort"/)
  assert.match(wxml, /data-sort="recent"[^>]+bindtap="changeSort"[^>]*>最近更新<\/view>/)
  assert.match(wxml, /data-sort="mostLiked"[^>]+bindtap="changeSort"[^>]*>最多喜爱<\/view>/)
  assert.doesNotMatch(wxml, /年份|出版时间/)
  assert.match(
    page,
    /changeSort\([\s\S]+games:\s*\[\][\s\S]+wx\.pageScrollTo\(\{ scrollTop: 0, duration: 0 \}\)[\s\S]+loadGames\(this\.requestFilters\(\)\)/
  )
  assert.match(wxml, /Powered by BGG/)
  assert.match(wxml, /bindtap="copyBggSource"/)
  assert.equal((wxml.match(/Powered by BGG/g) ?? []).length, 1)
})

test('board-game search and filter controls use shrinkable flex tracks', () => {
  const wxss = source('../src/pages/games/index.wxss')

  assert.match(
    wxss,
    /\.search-row\s*\{[^}]*display:\s*flex;/s
  )
  assert.match(
    wxss,
    /\.search-input\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1;/s
  )
  assert.match(
    wxss,
    /\.search-button\s*\{[^}]*width:\s*132rpx;[^}]*flex:\s*0\s+0\s+132rpx;/s
  )
  assert.match(
    wxss,
    /\.search-button\s*\{[^}]*padding:\s*0;[^}]*white-space:\s*nowrap;/s
  )
  assert.match(
    wxss,
    /\.quick-filters\s*\{[^}]*display:\s*flex;/s
  )
  assert.match(
    wxss,
    /\.filter-pill\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*0;[^}]*flex:\s*1;/s
  )
  assert.match(
    wxss,
    /\.sheet-actions\s*\{[^}]*display:\s*flex;/s
  )
  assert.match(
    wxss,
    /\.clear-button\s*\{[^}]*width:\s*180rpx;[^}]*flex:\s*0\s+0\s+180rpx;/s
  )
  assert.match(
    wxss,
    /\.apply-button\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*0;[^}]*flex:\s*1;/s
  )
})

test('board-game cards preview categories, reveal all details, and keep likes at card level', () => {
  const wxml = source('../src/components/board-game-card/index.wxml')
  const component = source('../src/components/board-game-card/index.ts')

  assert.match(wxml, /class="category-row category-preview"/)
  assert.match(wxml, /game\.previewCategories/)
  assert.match(wxml, /game\.hasMoreCategories/)
  assert.match(wxml, /wx:if="{{game.expanded}}"[^>]+class="game-introduction"/)
  assert.match(wxml, /wx:if="{{game.expanded}}" class="game-introduction"[\s\S]+class="category-row"/)
  assert.match(
    wxml,
    /{{game.playersText}} · {{game.durationText}} · {{game.complexityText}}/
  )
  assert.match(wxml, /game\.likedByViewer \? '♥' : '♡'/)
  assert.match(wxml, /catchtap="like"/)
  assert.match(wxml, /catchtap="viewExpansions"/)
  assert.match(wxml, /catchtap="selectCategory"/)
  assert.match(component, /pages\/games\/index\?category=/)
  assert.match(wxml, /\+{{game.expansionCount}}个扩展/)
  assert.doesNotMatch(wxml, /点击查看详细信息/)
  assert.match(wxml, /wx:if="{{game.expanded}}"/)
})

test('expansions use a separate returnable page with incremental loading', () => {
  const app = JSON.parse(source('../src/app.json'))
  const wxml = source('../src/pages/game-expansions/index.wxml')
  const page = source('../src/pages/game-expansions/index.ts')

  assert.ok(app.pages.includes('pages/game-expansions/index'))
  assert.match(wxml, /这里只展示与该基础游戏直接关联的扩展/)
  assert.match(wxml, /<board-game-card/)
  assert.match(wxml, /继续下滑加载更多/)
  assert.match(page, /baseGameId:/)
  assert.match(page, /game\.baseGameId === this\.data\.baseGameId/)
  assert.match(page, /decodeURIComponent/)
  assert.match(page, /onReachBottom\(\)/)
})

test('category search exposes fuzzy selectable matches', () => {
  const wxml = source('../src/pages/games/index.wxml')
  const page = source('../src/pages/games/index.ts')

  assert.match(wxml, /匹配到 {{categoryOptions.length}} 个标签，请选择/)
  assert.match(wxml, /没有匹配的标签/)
  assert.match(page, /category\.toLocaleLowerCase\('zh-CN'\)\.includes\(normalized\)/)
  assert.match(page, /discoveredCategories\(cards\)/)
})

test('board-game library renders five first-level navigation choices', () => {
  const wxml = source('../src/pages/games/index.wxml')
  const labels = ['首页', '桌游库', '工具', '明细', '我的']
  let position = -1
  for (const label of labels) {
    const next = wxml.indexOf(`>${label}</text>`, position + 1)
    assert.notEqual(next, -1, `missing navigation label ${label}`)
    assert.ok(next > position, `navigation label ${label} is out of order`)
    position = next
  }
})

test('every first-level customer page uses the same five-choice navigation order', () => {
  const pages = [
    '../src/pages/home/index.wxml',
    '../src/pages/games/index.wxml',
    '../src/pages/tools/index.wxml',
    '../src/pages/history/index.wxml',
    '../src/pages/member/index.wxml'
  ]
  for (const page of pages) {
    const wxml = source(page)
    let position = -1
    for (const label of ['首页', '桌游库', '工具', '明细', '我的']) {
      const next = wxml.indexOf(`>${label}</text>`, position + 1)
      assert.notEqual(next, -1, `${page} missing ${label}`)
      assert.ok(next > position, `${page} has ${label} out of order`)
      position = next
    }
  }
})

test('My links to a separate favorites page that reuses board-game cards', () => {
  const member = source('../src/pages/member/index.wxml')
  const favorites = source('../src/pages/favorites/index.wxml')

  assert.match(member, /我喜欢的/)
  assert.match(member, /已收藏 {{favoriteCount}} 款桌游/)
  assert.match(member, /bindtap="goFavorites"/)
  assert.match(favorites, /<board-game-card/)
  assert.match(favorites, /还没有喜欢的桌游，去桌游库逛逛吧/)
})
