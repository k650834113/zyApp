import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('board-game library exposes the approved search and filter controls', () => {
  const wxml = source('../src/pages/games/index.wxml')

  assert.match(wxml, /placeholder="搜索桌游名称或分类"/)
  assert.match(wxml, /<checkbox-group[^>]+bindchange="changeCategories"/s)
  assert.match(wxml, /<range-slider[^>]+bindchange="changePlayers"/s)
  assert.match(wxml, /<range-slider[^>]+bindchange="changeMinutes"/s)
  assert.match(wxml, /<range-slider[^>]+bindchange="changeComplexity"/s)
  assert.match(wxml, /查看 {{previewCount}} 款桌游/)
  assert.match(wxml, /<board-game-card/)
  assert.match(wxml, /没有找到符合条件的桌游/)
  assert.match(wxml, /加载失败，点击重试/)
  assert.doesNotMatch(wxml, /class="result-order"/)
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

test('board-game cards keep categories separate from one metadata row', () => {
  const wxml = source('../src/components/board-game-card/index.wxml')

  assert.match(wxml, /class="category-row"/)
  assert.match(
    wxml,
    /{{game.playersText}} · {{game.durationText}} · {{game.complexityText}}/
  )
  assert.match(wxml, /{{game.likedByViewer \? '♥' : '♡'}}/)
  assert.match(wxml, /catchtap="like"/)
  assert.match(wxml, /wx:if="{{game.expanded}}"/)
})

test('board-game library renders four first-level navigation choices', () => {
  const wxml = source('../src/pages/games/index.wxml')
  const labels = ['首页', '桌游库', '明细', '我的']
  let position = -1
  for (const label of labels) {
    const next = wxml.indexOf(`>${label}</text>`, position + 1)
    assert.notEqual(next, -1, `missing navigation label ${label}`)
    assert.ok(next > position, `navigation label ${label} is out of order`)
    position = next
  }
})

test('every first-level customer page uses the same four-choice navigation order', () => {
  const pages = [
    '../src/pages/home/index.wxml',
    '../src/pages/games/index.wxml',
    '../src/pages/history/index.wxml',
    '../src/pages/member/index.wxml'
  ]
  for (const page of pages) {
    const wxml = source(page)
    let position = -1
    for (const label of ['首页', '桌游库', '明细', '我的']) {
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
