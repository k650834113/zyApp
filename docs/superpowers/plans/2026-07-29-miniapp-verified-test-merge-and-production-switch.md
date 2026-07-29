# 小程序已验收测试版合并与生产库切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认使用隔离测试库的 0.23.2 新版会员小程序整体合入 `main`，验证测试构建后，再在不回退新版界面的前提下接入正式 API、正式门店、正式微信支付和发布防护。

**Architecture:** 先以非快进合并保留 `codex/member-recharge-pc-transactions` 的完整历史和跨端依赖，再把 `codex/miniapp-production-recharge` 的能力按原提交顺序逐项移植到新版基线。小程序始终只连接 HTTPS NestJS API；测试构建访问 `https://judian.icu/test`，最终 `production-wechat` 构建只访问 `https://judian.icu`。

**Tech Stack:** Git、pnpm 10.12.1、Node.js 24、TypeScript 5.9、Vitest 4、原生微信小程序 WXML/WXSS、NestJS、PostgreSQL、Redis、PowerShell、Docker Compose。

## Global Constraints

- 测试版必须整体合并 `codex/member-recharge-pc-transactions`，不能只复制 UI 文件。
- 新版会员三页面“首页 / 明细 / 我的”是界面基线，生产移植不得恢复旧首页、活动、员工、店长或内容管理入口。
- 金额使用整数分；订单、支付、钱包、月卡和退款记录保持追加、幂等和可审计。
- 生产构建只能访问 `https://judian.icu` 和正式门店 `7755df34-4309-43ed-8800-c0dc2049bb17`。
- 测试构建只能访问 `https://judian.icu/test` 和测试门店 `0f990a69-9783-4830-869f-8a2edc7601c0`。
- 正式构建禁止 `/test`、IP API、本地 HTTP、开发身份、虚拟手机号、Mock 支付和测试专用 0.01 元卡片。
- 保留测试版的自定义 0.01–1,000,000.00 元充值；0.01 元走与正式金额相同的订单和赠送规则，不恢复服务端测试金额特判。
- 不修改、暂存或提交 `infra/deploy/production.env.before-domain-20260725`。
- 不执行服务器部署、微信上传、真实付款、商户平台对账、审核或发布。
- 每个发生行为冲突的生产移植任务遵循 RED → GREEN；纯 Git 合并和原样移植使用已有测试证明等价。

---

### Task 1: 合并已验收的 0.23.2 测试候选

**Files:**
- Merge source: `codex/member-recharge-pc-transactions`
- Preserve: `docs/superpowers/specs/2026-07-29-miniapp-branch-integration-and-production-switch-design.md`
- Preserve untracked: `infra/deploy/production.env.before-domain-20260725`

**Interfaces:**
- Consumes: `main` at the approved design commit and tested branch tip `31db165`.
- Produces: one non-fast-forward merge commit on `main` containing the complete 0.23.2 candidate.

- [ ] **Step 1: Verify branch and worktree preconditions**

Run:

```powershell
git branch --show-current
git status --short --branch
git rev-parse codex/member-recharge-pc-transactions
git merge-base main codex/member-recharge-pc-transactions
git -C .worktrees/member-recharge-pc-transactions status --short --branch
```

Expected:

- Current branch is `main`.
- Candidate tip is `31db16523a18d89d52a0ed32559ba260975077df`.
- Candidate worktree is clean.
- The only unrelated untracked path in the main worktree is `infra/deploy/production.env.before-domain-20260725`.

- [ ] **Step 2: Verify the candidate release contract before merging**

Run:

```powershell
corepack pnpm --dir .worktrees/member-recharge-pc-transactions test:release-contract
corepack pnpm --dir .worktrees/member-recharge-pc-transactions miniapp:test
```

Expected: both commands exit 0; the release contract reports 0.23.2 and the exact `/test` endpoint.

- [ ] **Step 3: Merge the complete candidate branch**

Run:

```powershell
git merge --no-ff codex/member-recharge-pc-transactions -m "merge: integrate verified 0.23.2 candidate"
```

Expected: one merge commit is created. Resolve only actual path-level conflicts; never use repository-wide `--ours` or `--theirs`.

- [ ] **Step 4: Verify ancestry and preservation**

Run:

```powershell
git merge-base --is-ancestor 31db165 main
git log -1 --oneline
git status --short
```

Expected: ancestry command exits 0; the design document remains tracked; the environment backup remains untracked.

### Task 2: 验证新版界面仍连接隔离测试库

**Files:**
- Verify: `package.json`
- Verify: `apps/miniapp/scripts/build-configuration.mjs`
- Verify: `apps/miniapp/scripts/build-configuration.test.mjs`
- Verify: `apps/miniapp/src/app.json`
- Generated: `apps/miniapp/dist/**` (Git ignored)

**Interfaces:**
- Consumes: merged 0.23.2 candidate.
- Produces: a verified `production-test-wechat` build against the test API and test store.

- [ ] **Step 1: Run the 0.23.2 release isolation contract**

Run:

```powershell
corepack pnpm test:release-contract
```

Expected: `[release-contract] 0.23.2 metadata and isolation gates verified`.

- [ ] **Step 2: Run the merged miniapp and workspace verification**

Run:

```powershell
corepack pnpm miniapp:typecheck
corepack pnpm miniapp:test
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

Expected: all commands exit 0 with no failed tests or TypeScript errors.

- [ ] **Step 3: Generate the explicit test-database customer build**

Run in one PowerShell process:

```powershell
$env:ZYAPP_MINIAPP_MODE='production-test-wechat'
$env:ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED='false'
$env:ZYAPP_MINIAPP_API_BASE_URL='https://judian.icu/test'
$env:ZYAPP_MINIAPP_STORE_ID='0f990a69-9783-4830-869f-8a2edc7601c0'
corepack pnpm miniapp:build
Remove-Item Env:\ZYAPP_MINIAPP_MODE
Remove-Item Env:\ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED
Remove-Item Env:\ZYAPP_MINIAPP_API_BASE_URL
Remove-Item Env:\ZYAPP_MINIAPP_STORE_ID
```

Expected: build log contains `[miniapp] built production-test-wechat mode`.

- [ ] **Step 4: Inspect the generated test artifact**

Run:

```powershell
Select-String -Path apps/miniapp/dist/services/client.js -Pattern 'apiBaseUrl: "https://judian.icu/test"'
Select-String -Path apps/miniapp/dist/services/client.js -Pattern 'storeId: "0f990a69-9783-4830-869f-8a2edc7601c0"'
Get-Content -Raw -Encoding utf8 apps/miniapp/dist/app.json
```

Expected:

- Build config has `useMock: false`, `authMode: "wechat"`, `customerOnly: true`, and `realWechatPayment: true`.
- `app.json` exposes exactly `pages/home/index`, `pages/history/index`, and `pages/member/index`.
- The generated page tree contains no `staff`, `manager`, `content`, or `activities` directory.

- [ ] **Step 5: Record the test-stage checkpoint**

Run:

```powershell
git status --short
git log -1 --oneline
```

Expected: `dist` remains ignored and no tracked file changed. Stop here if any test or artifact assertion failed.

### Task 3: 移植权威充赠规则接口（来源 `fa6d252`）

**Files:**
- Create: `apps/api/src/recharge-gift-rules.ts`
- Create: `apps/api/src/recharge-gift-rules.test.ts`
- Modify: `apps/api/src/member-recharge.service.ts`
- Modify: `apps/api/src/member-recharge.service.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: existing `calculateMaximumRechargeGift`, merchant template/store override tables, and `MemberRechargeConfiguration`.
- Produces: `resolveRechargeGiftRules(pool, tenantId, storeId)` and `MemberRechargeConfiguration.giftTiers: RechargeGiftTierSummary[]`.

- [ ] **Step 1: Add the resolver test before production code**

Port the tests from `fa6d252:apps/api/src/recharge-gift-rules.test.ts`, preserving cases for merchant templates, store overrides, compatibility tiers, sorting, and invalid values.

Run:

```powershell
corepack pnpm test -- apps/api/src/recharge-gift-rules.test.ts
```

Expected: FAIL because `apps/api/src/recharge-gift-rules.ts` does not exist.

- [ ] **Step 2: Implement the reusable resolver**

Port `fa6d252:apps/api/src/recharge-gift-rules.ts`. Keep the resolver independent from controllers and ensure all returned `principalFen` and `giftFen` values are non-negative safe integers sorted by principal.

- [ ] **Step 3: Extend the shared contract without restoring test-amount behavior**

Modify the existing contract to:

```ts
export type MemberRechargeConfiguration = {
  providerMode: 'mock' | 'wechat'
  giftTiers: RechargeGiftTierSummary[]
}
```

Do not add `testAmountFen`; the merged 0.23.2 flow intentionally accepts custom 0.01 元 through the normal amount path.

- [ ] **Step 4: Make configuration and order creation share the resolver**

Change `MemberRechargeService.getConfiguration` to `async`, call `resolveRechargeGiftRules`, and return `providerMode` plus normalized `giftTiers`. Replace the duplicated template/tier query inside `createOrder` with the same resolver while preserving:

- member row locking and age-gate checks;
- arbitrary valid custom recharge amounts;
- existing idempotency and concurrent-order handling;
- gift snapshot persistence;
- payment provider invocation.

- [ ] **Step 5: Run focused RED/GREEN verification**

Run:

```powershell
corepack pnpm test -- apps/api/src/recharge-gift-rules.test.ts apps/api/src/member-recharge.service.test.ts
corepack pnpm typecheck
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 6: Commit the integrated rule source**

Run:

```powershell
git add apps/api/src/recharge-gift-rules.ts apps/api/src/recharge-gift-rules.test.ts apps/api/src/member-recharge.service.ts apps/api/src/member-recharge.service.test.ts packages/contracts/src/index.ts
git commit -m "feat: expose recharge gift rules on verified miniapp"
```

### Task 4: 移植客户端充赠预估（来源 `fe13340`）

**Files:**
- Create: `apps/miniapp/src/services/recharge-gift.ts`
- Create: `apps/miniapp/src/services/recharge-gift.test.ts`
- Modify: `apps/miniapp/src/services/mock-client.ts`
- Modify: `apps/miniapp/src/services/mock-client.test.ts`
- Modify: `apps/miniapp/package.json`

**Interfaces:**
- Consumes: `RechargeGiftTierSummary[]` from `MemberRechargeConfiguration`.
- Produces: `calculateRechargeGift(principalFen, tiers): number` and `formatRechargeRuleContent(tiers): string`.

- [ ] **Step 1: Add client calculation tests**

Port the real-code tests from `fe13340:apps/miniapp/src/services/recharge-gift.test.ts`, including:

- 999 元赠送 50 元；
- 1300 元赠送 220 元；
- empty rules return 0；
- rule text includes the highest-tier repeat and remainder behavior.

Run:

```powershell
corepack pnpm test -- apps/miniapp/src/services/recharge-gift.test.ts
```

Expected: FAIL because `recharge-gift.ts` does not exist.

- [ ] **Step 2: Implement the minimal client calculator**

Port `fe13340:apps/miniapp/src/services/recharge-gift.ts`. It may only calculate display estimates; it must not create orders or mutate balances.

- [ ] **Step 3: Add mock rule data and preserve existing mock member flow**

Update `MockMiniappClient.getRechargeConfiguration()` to return `providerMode: 'mock'` plus deterministic `giftTiers`. Update only the corresponding mock test assertions; preserve member profile, monthly card, history, and custom recharge behavior.

- [ ] **Step 4: Register and run the new test**

Append `apps/miniapp/src/services/recharge-gift.test.ts` to the existing miniapp Vitest list without removing any current test file.

Run:

```powershell
corepack pnpm miniapp:test
corepack pnpm miniapp:typecheck
```

Expected: all miniapp tests and typecheck pass.

- [ ] **Step 5: Commit the client estimator**

Run:

```powershell
git add apps/miniapp/package.json apps/miniapp/src/services/mock-client.ts apps/miniapp/src/services/mock-client.test.ts apps/miniapp/src/services/recharge-gift.ts apps/miniapp/src/services/recharge-gift.test.ts
git commit -m "feat: calculate recharge gifts in verified miniapp"
```

### Task 5: 把规则预估接入新版首页（来源 `5120857`）

**Files:**
- Modify: `apps/miniapp/scripts/member-page-layout.test.mjs`
- Modify: `apps/miniapp/src/pages/home/index.ts`
- Modify: `apps/miniapp/src/pages/home/index.wxml`
- Modify: `apps/miniapp/src/pages/home/index.wxss`

**Interfaces:**
- Consumes: `calculateRechargeGift`, `formatRechargeRuleContent`, merged `quickRechargeAmounts`, and `rechargeConfiguration.giftTiers`.
- Produces: estimated gift/arrival labels and `showRechargeRules()` on the existing new member homepage.

- [ ] **Step 1: Add a failing layout regression**

Append this test before changing the page:

```js
test('recharge area exposes gift estimates and current rules', () => {
  const wxml = source('../src/pages/home/index.wxml')
  const page = source('../src/pages/home/index.ts')

  assert.match(wxml, /class="recharge-gift-estimate"/)
  assert.match(wxml, /class="recharge-rule-info"/)
  assert.match(wxml, /bindtap="showRechargeRules"/)
  assert.match(page, /showRechargeRules\(\)/)
  assert.match(page, /formatRechargeRuleContent/)
})
```

Run:

```powershell
node --test apps/miniapp/scripts/member-page-layout.test.mjs
```

Expected: FAIL because the new homepage does not yet expose these elements.

- [ ] **Step 2: Add gift estimates to the existing quick recharge view model**

Keep the existing custom amount parser and selection flow. Enrich each quick amount with:

- `giftFen`;
- `giftText` formatted as `预计赠送 ¥X`;
- `totalText` formatted as `预计到账 ¥X`.

Recalculate these values whenever `MemberRechargeConfiguration` loads. Do not create a payment order during preview.

- [ ] **Step 3: Add the rule disclosure without changing page structure**

Inside the existing `recharge-card card`:

- render estimate text for each quick amount;
- keep the custom input and existing “微信支付” button;
- render “实际赠送以创建充值订单时的规则为准”;
- add an accessible `recharge-rule-info` button bound to `showRechargeRules`;
- call `wx.showModal` with `formatRechargeRuleContent(giftTiers)`.

Do not restore the old page title, activity page, employee pages, old recharge result card, or duplicated member center.

- [ ] **Step 4: Run page and miniapp verification**

Run:

```powershell
node --test apps/miniapp/scripts/member-page-layout.test.mjs
corepack pnpm miniapp:test
corepack pnpm miniapp:typecheck
```

Expected: the new regression and all existing miniapp tests pass.

- [ ] **Step 5: Commit the adapted new UI**

Run:

```powershell
git add apps/miniapp/scripts/member-page-layout.test.mjs apps/miniapp/src/pages/home/index.ts apps/miniapp/src/pages/home/index.wxml apps/miniapp/src/pages/home/index.wxss
git commit -m "feat: show recharge rules in redesigned miniapp"
```

### Task 6: Verify the formal build guard already present in 0.23.2（对应 `fbcdca6`）

**Files:**
- Verify: `apps/miniapp/scripts/build-configuration.mjs`
- Verify: `apps/miniapp/scripts/build-configuration.test.mjs`
- Verify: `apps/miniapp/README.md`
- Verify: `config/public-endpoints.example.json`

**Interfaces:**
- Consumes: the stronger `production-wechat` implementation already merged from `e5c7d9d` and `6c12584`.
- Produces: documented evidence that `fbcdca6` is functionally superseded and must not downgrade the store guard.

- [ ] **Step 1: Run the formal build guard tests**

Run:

```powershell
node --test apps/miniapp/scripts/build-configuration.test.mjs
```

Expected tests include and pass:

- released customer app accepts only `https://judian.icu`;
- production requires `miniappProductionStoreId`;
- a test-store environment override is rejected;
- test and production releases keep the same customer feature flags;
- the source manifest exposes only home, history, and member.

- [ ] **Step 2: Compare the old production commit without applying it**

Run:

```powershell
git diff fbcdca6^ fbcdca6 -- apps/miniapp/scripts/build-configuration.mjs apps/miniapp/scripts/build-configuration.test.mjs config/public-endpoints.example.json
```

Expected: current 0.23.2 code covers the same endpoint separation and adds the stronger requirement that an environment store override must match `miniappProductionStoreId`.

- [ ] **Step 3: Keep the stronger existing implementation**

Do not cherry-pick `fbcdca6`; it would weaken the store mismatch check and restore the old page manifest in its tests. No commit is created because the verified behavior already exists in `main`.

### Task 7: Enable formal WeChat payment without removing 0.23.2 avatar and URL support（来源 `f3869c4`）

**Files:**
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `infra/deploy/compose.production.yml`
- Modify: `infra/deploy/production.env.example`

**Interfaces:**
- Consumes: existing `ApiConfig`, avatar storage, `MINIAPP_PUBLIC_BASE_URL`, production/test Compose services.
- Produces: exact formal notify URL validation and a production API that requires real WeChat credentials while preserving isolated test behavior.

- [ ] **Step 1: Add failing production safety tests**

Add tests asserting:

```ts
expect(() =>
  readApiConfig(baseEnvironment({
    DEPLOYMENT_ENVIRONMENT: 'production',
    WECHAT_PAYMENT_MODE: 'wechat',
    WECHAT_PAY_NOTIFY_URL:
      'https://judian.icu/test/v1/payments/wechat/recharge/notify'
  }))
).toThrow(
  'Production WECHAT_PAY_NOTIFY_URL must be https://judian.icu/v1/payments/wechat/recharge/notify'
)
```

Also assert that a valid production config still returns `memberAvatarDirectory` and `miniappPublicBaseUrl`.

Run:

```powershell
corepack pnpm test -- apps/api/src/config.test.ts
```

Expected: FAIL on the missing exact production notification constraint.

- [ ] **Step 2: Add the exact production notification guard**

Port only the production notify URL validation from `f3869c4`. Preserve:

- `memberAvatarDirectory`;
- `miniappPublicBaseUrl`;
- the general 0.23.2 recharge flow without `WECHAT_PAYMENT_TEST_AMOUNT_FEN`;
- production prohibition of Mock payment.

- [ ] **Step 3: Enable formal payment in Compose while preserving avatar volumes**

For the `api` service:

- set `WECHAT_PAYMENT_MODE: wechat`;
- require merchant ID, certificate serial, public key ID, Mini Program AppID and AppSecret;
- mount the existing WeChat Pay secret directory read-only;
- use `https://judian.icu/v1/payments/wechat/recharge/notify`;
- use order prefix `ZYP-`;
- keep `MEMBER_AVATAR_DIRECTORY`, `MINIAPP_PUBLIC_BASE_URL`, and `member-avatar-production`.

For `api-test`:

- preserve `/test` notification URL, `ZYT-`, test database/Redis, avatar directory and avatar volume;
- do not set `WECHAT_PAYMENT_TEST_AMOUNT_FEN`;
- continue using `TEST_WECHAT_PAYMENT_MODE`.

- [ ] **Step 4: Update the example environment**

Set the documented production payment mode to `wechat`; retain test payment settings and all avatar/domain variables. Do not place any real secret value in the example.

- [ ] **Step 5: Run config and Compose checks**

Run:

```powershell
corepack pnpm test -- apps/api/src/config.test.ts
corepack pnpm typecheck
docker compose --env-file infra/deploy/production.env.example -f infra/deploy/compose.production.yml config --quiet
```

Expected: tests/typecheck pass and Compose config validates without removing either avatar volume.

- [ ] **Step 6: Commit the adapted production payment configuration**

Run:

```powershell
git add apps/api/src/config.ts apps/api/src/config.test.ts infra/deploy/compose.production.yml infra/deploy/production.env.example
git commit -m "ops: enable formal miniapp payment on verified baseline"
```

### Task 8: Add formal deployment guard（来源 `7d76ee4`）

**Files:**
- Create: `infra/scripts/deploy-miniapp-production.ps1`

**Interfaces:**
- Consumes: production/test Compose services, production backup directory, migration metadata, formal/test health endpoints, ignored public endpoints.
- Produces: a guarded production deployment script with `-ValidateOnly`.

- [ ] **Step 1: Port the deployment script exactly from the production branch**

Run:

```powershell
git show codex/miniapp-production-recharge:infra/scripts/deploy-miniapp-production.ps1
```

Create `infra/scripts/deploy-miniapp-production.ps1` with that content. Do not execute deployment.

- [ ] **Step 2: Parse the script and inspect required safety gates**

Run:

```powershell
$tokens=$null
$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path 'infra/scripts/deploy-miniapp-production.ps1'),
  [ref]$tokens,
  [ref]$errors
) | Out-Null
if ($errors.Count -ne 0) { $errors | Format-List; exit 1 }
Select-String -Path infra/scripts/deploy-miniapp-production.ps1 -Pattern 'ValidateOnly','pg_dump','sha256','DEPLOYMENT_ENVIRONMENT','https://judian.icu/test','production-wechat'
```

Expected: no parser errors; every safety marker is present.

- [ ] **Step 3: Commit the deployment guard**

Run:

```powershell
git add infra/scripts/deploy-miniapp-production.ps1
git commit -m "ops: guard formal miniapp deployment"
```

### Task 9: Integrate formal acceptance documentation（来源 `82c1c84`）

**Files:**
- Modify: `docs/人工验收计划.md`
- Modify: `docs/开发任务路线图-v1.md`
- Modify: `infra/scripts/deploy-miniapp-production.ps1`
- Modify: `docs/superpowers/specs/2026-07-29-miniapp-branch-integration-and-production-switch-design.md`

**Interfaces:**
- Consumes: the 0.23.2 acceptance sections and production acceptance content from `82c1c84`.
- Produces: one non-duplicated formal Mini Program acceptance checklist aligned with the merged three-page UI and normal custom 0.01 flow.

- [ ] **Step 1: Compare the documentation commit**

Run:

```powershell
git show 82c1c84 -- docs/人工验收计划.md docs/开发任务路线图-v1.md infra/scripts/deploy-miniapp-production.ps1
```

- [ ] **Step 2: Merge the formal acceptance content**

Add the owner-only steps for:

- experience build upload;
- real WeChat login and phone authorization;
- formal member/balance/history verification;
- recharge gift estimate and rule modal;
- real payment and merchant-platform reconciliation;
- PC sync and wallet/ledger reconciliation;
- privacy review, audit, and release.

Keep the existing 0.23.2 test acceptance content. Replace references to a dedicated one-cent card with “在自定义金额中输入 0.01 元” only for the isolated test environment.

- [ ] **Step 3: Mark the integration design as approved**

Change its status line to:

```text
状态：已确认并进入实施
```

- [ ] **Step 4: Check documentation consistency**

Run:

```powershell
rg -n "0\\.01|production-wechat|https://judian\\.icu/test|https://judian\\.icu|首页 / 明细 / 我的" docs/人工验收计划.md docs/开发任务路线图-v1.md docs/superpowers/specs/2026-07-29-miniapp-branch-integration-and-production-switch-design.md
git diff --check
```

Expected: test and production steps are clearly separated; no production instruction enables a dedicated 0.01 card or `/test`.

- [ ] **Step 5: Commit the integrated acceptance docs**

Run:

```powershell
git add docs/人工验收计划.md docs/开发任务路线图-v1.md infra/scripts/deploy-miniapp-production.ps1 docs/superpowers/specs/2026-07-29-miniapp-branch-integration-and-production-switch-design.md
git commit -m "docs: integrate formal miniapp acceptance"
```

### Task 10: Run full verification and leave a formal production build

**Files:**
- Modify ignored local config: `config/public-endpoints.local.json`
- Generated: `apps/miniapp/dist/**` (Git ignored)
- Verify: all tracked files changed by Tasks 1–9

**Interfaces:**
- Consumes: integrated `main`, formal public endpoint, formal store ID.
- Produces: verified tracked source plus a local `production-wechat` artifact for Developer Tools.

- [ ] **Step 1: Update only the two formal public endpoint fields**

Load `config/public-endpoints.local.json` as JSON, preserve every existing field, and set:

```json
{
  "miniappProductionApiBaseUrl": "https://judian.icu",
  "miniappProductionStoreId": "7755df34-4309-43ed-8800-c0dc2049bb17"
}
```

Do not print database credentials or payment secrets; this file contains only public endpoints and IDs.

- [ ] **Step 2: Run the complete verification floor**

Run:

```powershell
corepack pnpm miniapp:typecheck
corepack pnpm miniapp:test
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

Expected: every command exits 0 with no failed test.

- [ ] **Step 3: Generate the final formal build**

Run in one PowerShell process:

```powershell
$env:ZYAPP_MINIAPP_MODE='production-wechat'
$env:ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED='false'
corepack pnpm miniapp:build
Remove-Item Env:\ZYAPP_MINIAPP_MODE
Remove-Item Env:\ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED
```

Expected: `[miniapp] built production-wechat mode`.

- [ ] **Step 4: Verify formal artifact invariants**

Run:

```powershell
Select-String -Path apps/miniapp/dist/services/client.js -Pattern 'apiBaseUrl: "https://judian.icu"'
Select-String -Path apps/miniapp/dist/services/client.js -Pattern 'storeId: "7755df34-4309-43ed-8800-c0dc2049bb17"'
$forbidden=rg -n 'judian\.icu/test|127\.0\.0\.1|testVirtualPhoneEnabled: true|developmentProviderSubject: "[^"]+"' apps/miniapp/dist
if ($LASTEXITCODE -eq 0) { $forbidden; exit 1 }
$manifest=Get-Content -Raw -Encoding utf8 apps/miniapp/dist/app.json | ConvertFrom-Json
$expected=@('pages/home/index','pages/history/index','pages/member/index')
if ((Compare-Object $expected $manifest.pages).Count -ne 0) {
  throw 'Formal miniapp manifest does not contain exactly the approved member pages'
}
```

Expected:

- exact formal API and store ID;
- `useMock: false`, `authMode: "wechat"`, `customerOnly: true`, `realWechatPayment: true`;
- no forbidden test/development marker;
- exactly the three approved pages.

- [ ] **Step 5: Confirm Git scope and final ancestry**

Run:

```powershell
git merge-base --is-ancestor 31db165 main
git status --short
git log --graph --decorate --oneline -20
```

Expected:

- verified candidate is an ancestor of `main`;
- no tracked file is modified or staged;
- `infra/deploy/production.env.before-domain-20260725` remains the only unrelated untracked file;
- ignored local endpoints and `dist` are not staged.

- [ ] **Step 6: Record external acceptance gates**

Report that Developer Tools upload, real login, phone authorization, real payment, merchant reconciliation, PC synchronization, privacy review, audit, and release remain owner-only manual steps. Do not claim simulator or automated verification equals production acceptance.
