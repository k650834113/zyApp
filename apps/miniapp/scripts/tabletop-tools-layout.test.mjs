import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('toolbox exposes all five approved tabletop tools', () => {
  const app = JSON.parse(source('../src/app.json'))
  const toolbox = source('../src/pages/tools/index.wxml')
  const page = source('../src/pages/tools/index.ts')

  for (const tool of ['先手玩家', '玩家分队', '快速骰子', '抛硬币', '计分器']) {
    assert.match(page, new RegExp(tool))
  }
  for (const route of [
    'tool-first-player',
    'tool-teams',
    'tool-dice',
    'tool-coin',
    'tool-score'
  ]) {
    assert.ok(app.pages.includes(`pages/${route}/index`))
  }
  assert.match(toolbox, /<ui-nav active="tools"\/>/)
  assert.doesNotMatch(page, /getMemberSummary|purchaseMonthlyCard|createRechargeOrder/)
})

test('first-player tool supports true multitouch and a one-finger fallback', () => {
  const wxml = source('../src/pages/tool-first-player/index.wxml')
  const page = source('../src/pages/tool-first-player/index.ts')

  assert.match(wxml, /catchtouchstart="handleTouchStart"/)
  assert.match(wxml, /catchtouchmove="handleTouchMove"/)
  assert.match(wxml, /catchtouchend="handleTouchEnd"/)
  assert.match(wxml, /class="touch-layer single-touch-layer" bindtap="addSinglePlayer"/)
  assert.match(wxml, /bindtap="addSinglePlayerFromButton"/)
  assert.match(page, /markers\.length < 2/)
  assert.match(page, /candidateSignature === nextSignature/)
  assert.match(page, /playToolTone\('success'\)/)
})

test('teams assign simultaneous touches by team color', () => {
  const teams = source('../src/pages/tool-teams/index.wxml')
  const page = source('../src/pages/tool-teams/index.ts')
  assert.match(teams, /catchtouchstart="handleTouchStart"/)
  assert.match(teams, /相同颜色的玩家属于同一队|item\.teamLabel/)
  assert.match(page, /createRandomTeams\(this\.data\.markers\.length/)
  assert.match(page, /setTimeout\(\(\) =>/)
})

test('dice, coin, and scorer expose the revised interactions', () => {
  const dice = source('../src/pages/tool-dice/index.wxml')
  const dicePage = source('../src/pages/tool-dice/index.ts')
  assert.match(dice, /选择骰子/)
  assert.match(dice, /class="dice-count-row/)
  assert.match(dice, /data-sides="\{\{group\.sides\}\}"/)
  assert.match(dice, /bindtap="adjustCount"/)
  assert.match(dice, /bindtap="roll"/)
  assert.ok(
    dice.indexOf('class="dice-stage') < dice.indexOf('class="dice-controls card"'),
    'the dice results must be above the fixed count rows'
  )
  assert.match(dicePage, /sides === 6 \? 2 : 0/)
  assert.doesNotMatch(dice, /addGroup|chooseSides|sideOptions/)
  assert.doesNotMatch(dice, /摇一摇|shake-hint/)
  assert.doesNotMatch(dicePage, /Accelerometer|enableShake|disableShake/)

  const coin = source('../src/pages/tool-coin/index.wxml')
  assert.match(coin, /正面/)
  assert.match(coin, /headsCount/)
  assert.match(coin, /tailsCount/)

  const scorer = source('../src/pages/tool-score/index.wxml')
  assert.match(scorer, /bindinput="inputScore"/)
  assert.doesNotMatch(scorer, /score-head page-shell|score-actions page-shell/)
  assert.match(scorer, /wx:for="\{\{players\}\}" wx:key="id" wx:for-item="player"/)
  assert.doesNotMatch(scorer, /score-step|adjustScore/)
  assert.match(scorer, /class="add-row" bindtap="addRow"/)
  assert.match(scorer, /class="add-player" bindtap="addPlayer"/)
  assert.match(scorer, /\{\{totals\[index\]\}\}/)
  assert.match(scorer, /bindtap="resetScores"/)
})

test('toolbox cards only present an original icon and tool name', () => {
  const toolbox = source('../src/pages/tools/index.wxml')
  const page = source('../src/pages/tools/index.ts')
  assert.doesNotMatch(page, /description:/)
  assert.doesNotMatch(toolbox, /tool-description/)
  for (const glyph of ['first', 'teams', 'dice', 'coin', 'score']) {
    assert.match(page, new RegExp(`glyph: '${glyph}'`))
  }
})
