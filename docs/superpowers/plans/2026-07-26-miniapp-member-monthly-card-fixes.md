# Miniapp Member Monthly Card Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the miniapp member layout, expose offline recharge history, reconcile PC member tiers, and add a prominent WeChat-paid monthly-card open/renew flow without changing production before acceptance.

**Architecture:** Deliver three independently testable units: read-model/UI fixes, PC-to-cloud tier reconciliation, and a dedicated monthly-card payment order. Reuse the existing WeChat payment adapter and trusted settlement rules, but never route monthly-card money through the wallet ledger.

**Tech Stack:** TypeScript, native WeChat Mini Program WXML/WXSS, NestJS, PostgreSQL, SQLite, Vitest, pnpm.

## Global Constraints

- Stored value cannot buy monthly cards.
- Default monthly-card plan is 20,000 fen for 30 days.
- Active cards renew from their current expiry; paused cards reject customer renewal.
- All money remains integer fen and all settlement operations are idempotent.
- Experience and production builds use identical feature code while keeping API, store, database, Redis, order prefixes, and callbacks isolated.
- Publish only the test API and PC test update channel before user acceptance.
- Do not merge or push Git before user acceptance.

---

### Task 1: Correct the member page layouts

**Files:**
- Modify: `apps/miniapp/src/pages/home/index.wxml`
- Modify: `apps/miniapp/src/pages/home/index.wxss`
- Modify: `apps/miniapp/src/pages/history/index.wxml`
- Modify: `apps/miniapp/src/pages/history/index.wxss`
- Modify: `apps/miniapp/src/pages/member/index.wxml`
- Modify: `apps/miniapp/src/pages/member/index.wxss`
- Test: `apps/miniapp/src/pages/home/index.test.ts`

**Interfaces:**
- Consumes: `MemberSelfServiceSummary`
- Produces: responsive member header and conditional edit-profile heading

- [ ] **Step 1: Write failing source-structure tests**

```ts
expect(homeWxml).not.toContain('<view class="page-title">会员中心</view>')
expect(homeWxml).toContain('class="profile-identity"')
expect(historyWxml).not.toContain('class="history-title"')
expect(memberWxml).toContain('wx:if="{{mode === \'complete\'}}" class="profile-heading"')
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `corepack pnpm --filter @zyapp/miniapp test -- src/pages/home/index.test.ts`
Expected: FAIL because the duplicate titles and old profile row still exist.

- [ ] **Step 3: Implement the responsive layout**

Use a flexible identity wrapper:

```xml
<view class="profile-name-row">
  <view class="profile-identity">
    <text class="profile-name">{{member.nickname}}</text>
    <text class="member-tier">{{member.tierText}}</text>
  </view>
  <button class="edit-profile" bindtap="goProfile">编辑</button>
</view>
```

Keep the native navigation titles, remove only the repeated content headings, and retain the onboarding heading only when `mode === 'complete'`.

- [ ] **Step 4: Run miniapp tests and typecheck**

Run: `corepack pnpm --filter @zyapp/miniapp test && corepack pnpm miniapp:typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/miniapp/src/pages
git commit -m "fix: improve miniapp member page layouts"
```

### Task 2: Project offline recharge and reversal activities

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/member-self-service.service.ts`
- Modify: `apps/api/src/member-self-service.service.test.ts`
- Modify: `apps/miniapp/src/pages/home/index.ts`
- Modify: `apps/miniapp/src/pages/history/index.ts`
- Test: `apps/miniapp/src/pages/history/index.test.ts`

**Interfaces:**
- Consumes: `cloud_wallet_ledger.event_type`
- Produces: `MemberActivitySummary.status = 'reversed'` and cash recharge activity cards

- [ ] **Step 1: Write failing API and view-model tests**

```ts
expect(history.activities.map((item) => item.title)).toEqual([
  '线下充值',
  '微信充值',
  '线下充值冲正'
])
expect(statusText('reversed')).toBe('已冲正')
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `corepack pnpm --filter @zyapp/api test -- src/member-self-service.service.test.ts && corepack pnpm --filter @zyapp/miniapp test -- src/pages/history/index.test.ts`
Expected: FAIL because wallet rows are not included in `activities`.

- [ ] **Step 3: Add wallet activity mapping**

Map only these ledger events:

```ts
if (row.event_type === 'wallet.cash_recharged') {
  return { title: '线下充值', amountFen: principal + gift, direction: 'credit', status: 'settled' }
}
if (row.event_type === 'wallet.cash_recharge_reversed') {
  return { title: '线下充值冲正', amountFen: Math.abs(principal + gift), direction: 'debit', status: 'reversed' }
}
```

Do not map `wallet.wechat_recharged`; the settled WeChat order remains its sole visible activity.

- [ ] **Step 4: Run contract, API, and miniapp tests**

Run: `corepack pnpm --filter @zyapp/contracts typecheck && corepack pnpm --filter @zyapp/api test -- src/member-self-service.service.test.ts && corepack pnpm --filter @zyapp/miniapp test`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts apps/api/src/member-self-service.service* apps/miniapp/src/pages/home apps/miniapp/src/pages/history
git commit -m "fix: show offline recharges in member history"
```

### Task 3: Emit authoritative PC member-tier reconciliation

**Files:**
- Modify: `packages/local-db/src/wallet.ts`
- Modify: `packages/local-db/src/wallet.test.ts`
- Create: `packages/local-db/src/member-tier-reconciliation.ts`
- Create: `packages/local-db/src/member-tier-reconciliation.test.ts`
- Modify: `packages/local-db/src/index.ts`
- Modify: `apps/merchant-desktop/src/main/index.ts`
- Modify: `packages/cloud-db/src/sync-operation-handler.ts`
- Modify: `packages/cloud-db/src/sync-operation-handler.test.ts`

**Interfaces:**
- Produces: `member.tier.reconciled` outbox payload

```ts
type MemberTierReconciledPayload = {
  action: 'member.tier.reconciled'
  memberId: string
  after: { tier: 'ordinary' | 'advanced'; updatedAt: string }
  reason: string
}
```

- [ ] **Step 1: Write failing local transaction tests**

Assert that a qualifying cash recharge and its reversal each append a `member.tier.reconciled` outbox in the same transaction, and that another active manual grant keeps the reversal result advanced.

- [ ] **Step 2: Run local-db focused tests and verify failure**

Run: `corepack pnpm --filter @zyapp/local-db test -- src/wallet.test.ts src/member-tier-reconciliation.test.ts`
Expected: FAIL because no tier reconciliation outbox exists.

- [ ] **Step 3: Implement tier outbox helpers**

Create helpers that compute tier from active `membership_grant` rows and append an idempotent member operation using the current device sequence. Call the helper after the grant insert/revoke but before the wallet transaction commits.

- [ ] **Step 4: Add one-time historical reconciliation**

At authenticated desktop runtime startup, call:

```ts
ensureMemberTierReconciliationOutbox(database, context, {
  marker: 'member-tier-reconciliation-v1',
  reason: '历史会员等级云端对账'
})
```

The helper queues at most one current projection per member and writes its completion marker transactionally.

- [ ] **Step 5: Write and implement cloud handler tests**

Verify that `member.tier.reconciled` locks the tenant member, appends an event and audit row, and updates `cloud_member.tier` regardless of the member's origin store.

- [ ] **Step 6: Run local, cloud, and desktop tests**

Run: `corepack pnpm --filter @zyapp/local-db test && corepack pnpm --filter @zyapp/cloud-db test && corepack pnpm --filter @zyapp/merchant-desktop typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add packages/local-db packages/cloud-db apps/merchant-desktop/src/main/index.ts
git commit -m "fix: reconcile PC member tiers to cloud"
```

### Task 4: Add monthly-card payment contracts and migration

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/cloud-db/migrations/0018_member_wechat_monthly_card.sql`
- Modify: `packages/cloud-db/src/migrations.test.ts`
- Modify: `packages/cloud-db/src/schema.ts`

**Interfaces:**
- Produces: `MemberMonthlyCardConfiguration`, `CreateMemberMonthlyCardOrderRequest`, and `MemberMonthlyCardOrderSummary`
- Produces table: `wechat_monthly_card_order`

- [ ] **Step 1: Write failing migration assertions**

```ts
expect(sql).toContain('CREATE TABLE wechat_monthly_card_order')
expect(sql).toContain('UNIQUE (tenant_id, identity_id, request_id)')
expect(sql).toContain('CHECK (status IN')
```

- [ ] **Step 2: Run migration tests and verify failure**

Run: `corepack pnpm --filter @zyapp/cloud-db test -- src/migrations.test.ts`
Expected: FAIL because migration 18 is absent.

- [ ] **Step 3: Add contracts and SQL schema**

The order stores the frozen plan snapshot, provider identifiers, client parameters, status, target card, and before/after expiry. Extend `payment_callback_inbox` with nullable `monthly_card_order_id`.

- [ ] **Step 4: Run migration and contract checks**

Run: `corepack pnpm --filter @zyapp/cloud-db test -- src/migrations.test.ts && corepack pnpm --filter @zyapp/contracts typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts packages/cloud-db
git commit -m "feat: add monthly card payment order schema"
```

### Task 5: Implement trusted monthly-card payment settlement

**Files:**
- Create: `apps/api/src/member-monthly-card.service.ts`
- Create: `apps/api/src/member-monthly-card.service.test.ts`
- Modify: `apps/api/src/member-self-service.controller.ts`
- Modify: `apps/api/src/wechat-payment.controller.ts`
- Modify: `apps/api/src/wechat-payment.controller.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/wechat-payment-provider.ts`
- Modify: `apps/api/src/wechatpay-provider.ts`

**Interfaces:**
- Consumes: generic payment creation/query/verification from `WechatPaymentProvider`
- Produces: configuration, create order, get order, mock settle, and notification settlement methods

- [ ] **Step 1: Write failing service tests**

Cover default/template configuration, first purchase, active renewal, paused rejection, amount/OpenID mismatch, member disablement, and duplicate settlement.

- [ ] **Step 2: Run the service test and verify failure**

Run: `corepack pnpm --filter @zyapp/api test -- src/member-monthly-card.service.test.ts`
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Generalize the payment adapter**

Replace recharge-specific method names with:

```ts
createPayment(input: { outTradeNo: string; amountFen: number; payerSubject: string; description: string; expiresAt: string }): Promise<CreatedWechatPayment>
queryPayment(outTradeNo: string): Promise<WechatPaymentState>
closePayment(outTradeNo: string): Promise<'closed' | 'paid'>
```

Update recharge callers without changing behavior.

- [ ] **Step 4: Implement order creation and trusted settlement**

Resolve and freeze the plan. On trusted success, lock order/member/card; create a new active card or extend an active card; append one `monthly_card.purchased` event containing the order and expiry snapshots; mark the order settled. Never insert into `cloud_wallet_ledger`.

- [ ] **Step 5: Add routes and shared callback dispatch**

Expose member routes under `/v1/member/monthly-card-*`. In the existing verified notification controller, route the payment first to the matching recharge or monthly-card order by `outTradeNo`.

- [ ] **Step 6: Run API tests and typecheck**

Run: `corepack pnpm --filter @zyapp/api test && corepack pnpm --filter @zyapp/api typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/api
git commit -m "feat: add member monthly card WeChat payments"
```

### Task 6: Add prominent monthly-card miniapp flow

**Files:**
- Modify: `apps/miniapp/src/services/types.ts`
- Modify: `apps/miniapp/src/services/http-client.ts`
- Modify: `apps/miniapp/src/services/http-client.test.ts`
- Modify: `apps/miniapp/src/services/mock-client.ts`
- Modify: `apps/miniapp/src/services/mock-client.test.ts`
- Create: `apps/miniapp/src/services/monthly-card-payment.ts`
- Create: `apps/miniapp/src/services/monthly-card-payment.test.ts`
- Modify: `apps/miniapp/src/pages/home/index.ts`
- Modify: `apps/miniapp/src/pages/home/index.wxml`
- Modify: `apps/miniapp/src/pages/home/index.wxss`

**Interfaces:**
- Consumes: monthly-card configuration/order API
- Produces: open/renew button and WeChat request-payment flow

- [ ] **Step 1: Write failing HTTP, payment, and page tests**

Assert exact routes, `wx.requestPayment` invocation, settled-order refresh, prominent monthly-card markup, and paused-card disabled state.

- [ ] **Step 2: Run miniapp tests and verify failure**

Run: `corepack pnpm --filter @zyapp/miniapp test`
Expected: FAIL because monthly-card client methods and page state are absent.

- [ ] **Step 3: Implement client and payment orchestration**

Mirror the recharge payment orchestration while keeping a distinct request prefix and distinct stored order state.

- [ ] **Step 4: Implement the prominent card**

Render plan price, duration, current expiry/status, and `立即开通` or `微信续费`. Place it between the balance and wallet recharge cards.

- [ ] **Step 5: Run miniapp tests, typecheck, and experience build**

Run: `corepack pnpm --filter @zyapp/miniapp test && corepack pnpm miniapp:typecheck && $env:ZYAPP_MINIAPP_MODE='production-test-wechat'; corepack pnpm miniapp:build`
Expected: PASS and `apps/miniapp/dist` targets `https://judian.icu/test`.

- [ ] **Step 6: Commit**

```powershell
git add apps/miniapp
git commit -m "feat: add prominent monthly card purchase flow"
```

### Task 7: Preserve WeChat payment method in the PC mirror

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/local-db/src/migrations.ts`
- Modify: `packages/local-db/src/cloud-mirror-materialization.ts`
- Modify: `packages/local-db/src/cloud-mirror-materialization.test.ts`
- Modify: `apps/api/src/desktop-mirror.service.ts`
- Modify: `apps/api/src/desktop-mirror.service.test.ts`

**Interfaces:**
- Produces: `MonthlyCardSummary.paymentMethod: 'cash' | 'wechat'`
- Produces mirror resource: `monthly_card_payment_orders`

- [ ] **Step 1: Write failing mirror tests**

Assert that a cloud monthly card with `payment_method = 'wechat'` remains WeChat in SQLite and that monthly-card payment orders are returned by the mirror API.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `corepack pnpm --filter @zyapp/local-db test -- src/cloud-mirror-materialization.test.ts && corepack pnpm --filter @zyapp/api test -- src/desktop-mirror.service.test.ts`
Expected: FAIL because the current mirror hardcodes cash.

- [ ] **Step 3: Expand SQLite and mirror projection**

Add a local migration that rebuilds the monthly-card payment-method check for `cash | wechat`, map the actual cloud value, and add a read-only monthly-card payment order mirror table/resource.

- [ ] **Step 4: Run local/API tests and typechecks**

Run: `corepack pnpm --filter @zyapp/local-db test && corepack pnpm --filter @zyapp/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts packages/local-db apps/api
git commit -m "fix: preserve WeChat monthly card payments on PC"
```

### Task 8: Full verification and isolated test deployment

**Files:**
- Modify: `apps/miniapp/README.md`
- Modify: `docs/正式需求基线-v2-PC优先.md`
- Create: `docs/验收记录/2026-07-26-小程序会员与月卡体验版验收.md`

**Interfaces:**
- Consumes: all prior tasks
- Produces: test API deployment, PC test update, and experience build

- [ ] **Step 1: Run complete verification**

Run:

```powershell
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
git diff --check
```

Expected: all commands succeed.

- [ ] **Step 2: Deploy only the test API**

Run the existing `infra/scripts/deploy-miniapp-production-test.ps1` with the locally protected deployment paths. Expected: test migration and `api-test` are updated; production API and Caddy container IDs are unchanged; both health checks return 200.

- [ ] **Step 3: Publish only the PC test update**

Build the next test-channel Windows release and run the existing test release script. Expected: the test update manifest points to the new artifact while the production manifest remains byte-for-byte unchanged.

- [ ] **Step 4: Build the experience miniapp**

Run the `production-test-wechat` build and leave it in `apps/miniapp/dist` for WeChat DevTools upload.

- [ ] **Step 5: Record verification and commit**

```powershell
git add apps/miniapp/README.md docs
git commit -m "docs: record member monthly card test release"
```

- [ ] **Step 6: Stop before production or Git remote changes**

Report the experience-build path, test API health, PC test update version, and manual scenarios. Do not merge, push, update production API, or publish the production PC channel.
