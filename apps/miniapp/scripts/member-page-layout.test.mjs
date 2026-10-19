import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('member identity stays visible without a duplicate home title', () => {
  const wxml = source('../src/pages/member/index.wxml')

  assert.doesNotMatch(wxml, /class="page-title">会员中心/)
  assert.match(wxml, /class="profile-identity"/)
})

test('monthly card keeps its purchase guard and expiry on a separate page', () => {
  const wxml = source('../src/pages/monthly-card/index.wxml')
  assert.match(wxml, /bindtap="purchaseMonthlyCard"/)
  assert.match(wxml, /monthlyCardConfiguration.purchaseAllowed/)
  assert.match(wxml, /monthlyCardExpiresOn/)
  assert.match(wxml, /monthlyCardRemainingDaysText/)
  assert.match(wxml, /monthlyCardActionText/)
})

test('history page has no duplicate content title', () => {
  const wxml = source('../src/pages/history/index.wxml')

  assert.doesNotMatch(wxml, /class="history-title"/)
})

test('profile heading is limited to member onboarding', () => {
  const wxml = source('../src/pages/profile/index.wxml')

  assert.match(
    wxml,
    /<view wx:if="{{mode === 'complete'}}" class="profile-heading">/
  )
  assert.doesNotMatch(
    wxml,
    /mode === 'complete' \? '完善会员资料' : '我的资料'/
  )
})

test('the avatar itself opens image selection and immediately updates profiles', () => {
  const wxml = source('../src/pages/profile/index.wxml')
  const page = source('../src/pages/profile/index.ts')
  const picker = wxml.match(
    /<button[\s\S]*?class="avatar-picker-button"[\s\S]*?<\/button>/
  )?.[0]

  assert.ok(picker)
  assert.match(picker, /bindtap="chooseAvatar"/)
  assert.doesNotMatch(picker, /open-type="chooseAvatar"/)
  assert.match(picker, /class="profile-avatar"/)
  assert.doesNotMatch(wxml, /选择头像|头像选填|choose-avatar-label|avatar-tip/)
  assert.match(page, /wx\.chooseImage\(/)
  assert.match(page, /wx\.requirePrivacyAuthorize\(/)
  assert.match(
    page,
    /await requireAvatarPrivacyAuthorization\(\)[\s\S]*?await chooseAvatarFile\(\)/
  )
  assert.doesNotMatch(page, /wx\.chooseMedia\(/)
  assert.match(page, /sourceType: \['album', 'camera'\]/)
  assert.match(page, /api scope is not declared/)
  assert.match(page, /头像图片权限尚未配置/)
  assert.match(page, /async chooseAvatar\(\)/)
  assert.match(page, /this\.data\.mode === 'complete'/)
  assert.match(
    page,
    /updateMemberProfileWithAvatar\(\s*member\.nickname,\s*avatarUrl\s*\)/
  )
})

test('recharge area exposes gift estimates and current rules', () => {
  const wxml = source('../src/pages/recharge/index.wxml')
  const page = source('../src/services/account-page.ts')

  assert.match(wxml, /class="recharge-gift-estimate"/)
  assert.match(wxml, /class="recharge-rule-info"/)
  assert.match(wxml, /bindtap="showRechargeRules"/)
  assert.match(page, /showRechargeRules\(\)/)
  assert.match(page, /formatRechargeRuleContent/)
})

test('account pages preserve offline service scope and payment bindings', () => {
  const recharge = source('../src/pages/recharge/index.wxml')
  const month = source('../src/pages/monthly-card/index.wxml')
  const history = source('../src/pages/history/index.wxml')
  assert.match(recharge, /仅限到店消费/)
  assert.match(recharge, /bindtap="recharge"/)
  assert.match(month, /不解锁小程序内任何功能/)
  assert.match(month, /bindtap="purchaseMonthlyCard"/)
  assert.match(history, /预存款与月卡仅(?:对应据点桌游门店|用于门店)线下服务/)
})
