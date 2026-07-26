import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('member identity stays visible without a duplicate home title', () => {
  const wxml = source('../src/pages/home/index.wxml')

  assert.doesNotMatch(wxml, /class="page-title">会员中心/)
  assert.match(wxml, /class="profile-identity"/)
})

test('monthly card is a prominent standalone purchase card', () => {
  const wxml = source('../src/pages/home/index.wxml')

  assert.match(wxml, /class="monthly-card-feature card"/)
  assert.match(wxml, /bindtap="purchaseMonthlyCard"/)
  assert.match(wxml, /{{monthlyCardActionText}}/)
})

test('history page has no duplicate content title', () => {
  const wxml = source('../src/pages/history/index.wxml')

  assert.doesNotMatch(wxml, /class="history-title"/)
})

test('profile heading is limited to member onboarding', () => {
  const wxml = source('../src/pages/member/index.wxml')

  assert.match(
    wxml,
    /<view wx:if="{{mode === 'complete'}}" class="profile-heading">/
  )
  assert.doesNotMatch(
    wxml,
    /mode === 'complete' \? '完善会员资料' : '我的资料'/
  )
})
