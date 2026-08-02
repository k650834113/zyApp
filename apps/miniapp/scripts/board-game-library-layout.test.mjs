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
