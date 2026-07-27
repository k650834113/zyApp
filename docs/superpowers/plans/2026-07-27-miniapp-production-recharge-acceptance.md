# Miniapp Production Recharge Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show authoritative real-time recharge gift estimates in the customer miniapp and deliver a production-only WeChat build connected to the formal API, database, store, gift rules, and WeChat Pay configuration.

**Architecture:** The API will expose the same resolved recharge gift tiers used when it creates and freezes a recharge order. A focused miniapp helper will calculate display-only estimates and rule copy from those tiers, while the server remains the only financial authority. A new fail-closed `production-wechat` build mode and production deployment path will prevent test endpoints, test amounts, virtual login, Mock payment, and employee routes from entering the formal build.

**Tech Stack:** TypeScript 5.9, NestJS 11, PostgreSQL 17, native WeChat Mini Program TypeScript/WXML/WXSS, Node test runner, Vitest 4, PowerShell, Docker Compose, Caddy, WeChat Pay API v3.

## Global Constraints

- All money is integer fen; never calculate financial values with floating-point yuan.
- The existing highest-tier repetition and one-remainder-tier recharge algorithm is unchanged.
- The client estimate is display-only; `MemberRechargeService.createOrder()` must reread rules and freeze the authoritative result in `gift_rule_snapshot_json`.
- `production-wechat` must use exactly `https://judian.icu`, real WeChat auth, real WeChat payment, an explicit production store ID, and customer-only routes.
- `production-wechat` must reject `/test`, IP endpoints, HTTP endpoints, development auth, virtual phone login, Mock clients, and the one-cent test tier.
- Production payment notification URL is exactly `https://judian.icu/v1/payments/wechat/recharge/notify`.
- Production must not set `WECHAT_PAYMENT_TEST_AMOUNT_FEN`.
- Do not copy, seed, merge, rename, or restore test database data into the production database.
- Preserve append-only recharge orders, callback inbox rows, wallet ledgers, audit records, and idempotency.
- Do not expose database credentials, AppSecret, payment keys, certificates, reusable sessions, or full environment files in source, logs, screenshots, or command output.
- Preserve the user's untracked `infra/deploy/production.env.before-domain-20260725`; do not stage, edit, copy into an archive, or delete it.
- Native miniapp only; do not introduce React, Taro, UniApp, CloudBase, or a second router.

## File Structure

- `apps/api/src/recharge-gift-rules.ts`: one authoritative resolver for merchant templates, store overrides, and legacy active tier projection.
- `apps/api/src/recharge-gift-rules.test.ts`: resolver precedence, validation, sorting, and fallback tests.
- `apps/api/src/member-recharge.service.ts`: consumes the resolver for both configuration reads and order snapshot creation.
- `apps/api/src/member-recharge.service.test.ts`: proves configuration and order creation share the resolved rules.
- `packages/contracts/src/index.ts`: adds `giftTiers` to `MemberRechargeConfiguration`.
- `apps/miniapp/src/services/recharge-gift.ts`: pure estimate and rule-description functions.
- `apps/miniapp/src/services/recharge-gift.test.ts`: table-driven client estimate tests.
- `apps/miniapp/src/services/mock-client.ts`: returns the Mock environment's actual active gift tiers.
- `apps/miniapp/src/services/mock-client.test.ts`: verifies the configuration contract.
- `apps/miniapp/src/pages/home/index.ts`: builds formal recharge packages from configuration and opens the rule modal.
- `apps/miniapp/src/pages/home/index.wxml`: shows estimated gift, estimated credit, and the accessible exclamation control.
- `apps/miniapp/src/pages/home/index.wxss`: styles the estimate copy and rule control.
- `apps/miniapp/scripts/build-configuration.mjs`: adds the fail-closed production mode.
- `apps/miniapp/scripts/build-configuration.test.mjs`: exercises all allowed and rejected production inputs.
- `apps/miniapp/src/services/build-config.d.ts`: keeps the generated build configuration typed.
- `config/public-endpoints.example.json`: documents distinct public production miniapp fields.
- `apps/miniapp/README.md`: documents the formal build command and owner-only acceptance boundary.
- `apps/api/src/config.ts`: validates production and test payment notification URLs independently.
- `apps/api/src/config.test.ts`: tests formal WeChat Pay configuration and rejects test-only settings.
- `infra/deploy/compose.production.yml`: enables real WeChat Pay for the formal API and mounts existing server-side read-only keys.
- `infra/deploy/production.env.example`: separates production and test payment switches and prefixes without real secrets.
- `infra/scripts/deploy-miniapp-production.ps1`: production-only source/API deployment with preflight, backup, health, and read-only database checks.
- `docs/人工验收计划.md`: adds the final production miniapp recharge acceptance sequence.
- `docs/开发任务路线图-v1.md`: records the production acceptance candidate without claiming owner-only tests passed.

---

### Task 1: Resolve Authoritative Recharge Gift Rules Once

**Files:**
- Create: `apps/api/src/recharge-gift-rules.ts`
- Create: `apps/api/src/recharge-gift-rules.test.ts`
- Modify: `packages/contracts/src/index.ts:1293`
- Modify: `apps/api/src/member-recharge.service.ts:142-304`
- Modify: `apps/api/src/member-recharge.service.test.ts:160-285`

**Interfaces:**
- Produces:

```ts
export type ResolvedRechargeGiftTier = {
  id: string
  principalFen: number
  giftFen: number
}

export async function resolveRechargeGiftRules(
  queryable: Pool | PoolClient,
  tenantId: string,
  storeId: string
): Promise<ResolvedRechargeGiftTier[]>
```

- Extends:

```ts
export type MemberRechargeConfiguration = {
  providerMode: 'mock' | 'wechat'
  testAmountFen: number | null
  giftTiers: Array<{
    principalFen: number
    giftFen: number
  }>
}
```

- Consumers: `MemberRechargeService.getConfiguration()` and `MemberRechargeService.createOrder()`.

- [ ] **Step 1: Write failing resolver tests**

Create `apps/api/src/recharge-gift-rules.test.ts` with literal fixtures for:

```ts
it('prefers the active store override over the merchant template', async () => {
  const queryable = fakeQueryable((sql) => {
    if (sql.includes('cloud_merchant_business_template')) {
      return [{
        id: 'template-1',
        payload_json: {
          tiers: [{ principalFen: 30_000, giftFen: 2_000 }]
        },
        override_payload_json: {
          tiers: [{ principalFen: 30_000, giftFen: 3_000 }]
        }
      }]
    }
    return []
  })

  await expect(resolveRechargeGiftRules(
    queryable,
    'tenant-1',
    'store-1'
  )).resolves.toEqual([
    { id: 'template-1:0', principalFen: 30_000, giftFen: 3_000 }
  ])
})

it('falls back to active projected tiers when no template exists', async () => {
  const queryable = fakeQueryable((sql) =>
    sql.includes('cloud_recharge_gift_tier')
      ? [
          { id: 'tier-500', principal_fen: 50_000, gift_fen: 5_000 },
          { id: 'tier-300', principal_fen: 30_000, gift_fen: 2_000 }
        ]
      : []
  )

  await expect(resolveRechargeGiftRules(
    queryable,
    'tenant-1',
    'store-1'
  )).resolves.toEqual([
    { id: 'tier-300', principalFen: 30_000, giftFen: 2_000 },
    { id: 'tier-500', principalFen: 50_000, giftFen: 5_000 }
  ])
})

it.each([
  [[{ principalFen: 0, giftFen: 1 }], /principalFen/],
  [[{ principalFen: 30_000, giftFen: -1 }], /giftFen/],
  [[
    { principalFen: 30_000, giftFen: 2_000 },
    { principalFen: 30_000, giftFen: 3_000 }
  ], /unique/]
])('rejects invalid resolved template tiers', async (tiers, error) => {
  const queryable = templateQueryable(tiers)
  await expect(resolveRechargeGiftRules(
    queryable,
    'tenant-1',
    'store-1'
  )).rejects.toThrow(error)
})
```

The fake must execute the resolver's real SQL boundary and return complete row shapes; do not assert that a mock was called.

- [ ] **Step 2: Run the resolver tests and verify RED**

Run:

```powershell
corepack pnpm vitest run apps/api/src/recharge-gift-rules.test.ts
```

Expected: FAIL because `recharge-gift-rules.ts` and `resolveRechargeGiftRules` do not exist.

- [ ] **Step 3: Implement the resolver**

Create `apps/api/src/recharge-gift-rules.ts` with:

```ts
import type { Pool, PoolClient } from '@zyapp/cloud-db'

export type ResolvedRechargeGiftTier = {
  id: string
  principalFen: number
  giftFen: number
}

type TemplateRow = {
  id: string
  payload_json: Record<string, unknown>
  override_payload_json: Record<string, unknown> | null
}

type ProjectedTierRow = {
  id: string
  principal_fen: number | string
  gift_fen: number | string
}

function safeTier(
  id: string,
  principalValue: unknown,
  giftValue: unknown
): ResolvedRechargeGiftTier {
  const principalFen = Number(principalValue)
  const giftFen = Number(giftValue)
  if (!Number.isSafeInteger(principalFen) || principalFen <= 0) {
    throw new Error('recharge gift tier principalFen must be a positive safe integer')
  }
  if (!Number.isSafeInteger(giftFen) || giftFen < 0) {
    throw new Error('recharge gift tier giftFen must be a non-negative safe integer')
  }
  return { id, principalFen, giftFen }
}

function validated(
  tiers: ResolvedRechargeGiftTier[]
): ResolvedRechargeGiftTier[] {
  const sorted = [...tiers].sort(
    (left, right) => left.principalFen - right.principalFen
  )
  if (new Set(sorted.map((tier) => tier.principalFen)).size !== sorted.length) {
    throw new Error('recharge gift tier principal amounts must be unique')
  }
  return sorted
}

export async function resolveRechargeGiftRules(
  queryable: Pool | PoolClient,
  tenantId: string,
  storeId: string
): Promise<ResolvedRechargeGiftTier[]> {
  const template = await queryable.query<TemplateRow>(
    `SELECT template.id::text, template.payload_json,
            override.payload_json override_payload_json
       FROM cloud_merchant_business_template template
       LEFT JOIN cloud_store_business_template_override override
         ON override.tenant_id = template.tenant_id
        AND override.store_id = $2
        AND override.template_id = template.id
        AND override.active = TRUE
      WHERE template.tenant_id = $1
        AND template.template_type = 'recharge_gift_tier'
        AND template.active = TRUE
      ORDER BY template.created_at, template.id
      LIMIT 1`,
    [tenantId, storeId]
  )
  const row = template.rows[0]
  if (row) {
    const resolved = {
      ...row.payload_json,
      ...(row.override_payload_json ?? {})
    }
    if (!Array.isArray(resolved.tiers)) {
      throw new Error('active recharge gift template must contain tiers')
    }
    return validated(resolved.tiers.map((value, index) => {
      const tier = value as Record<string, unknown>
      return safeTier(
        `${row.id}:${index}`,
        tier.principalFen,
        tier.giftFen
      )
    }))
  }

  const projected = await queryable.query<ProjectedTierRow>(
    `SELECT id, principal_fen, gift_fen
       FROM cloud_recharge_gift_tier
      WHERE tenant_id = $1 AND store_id = $2 AND active = TRUE
      ORDER BY principal_fen`,
    [tenantId, storeId]
  )
  return validated(projected.rows.map((tier) =>
    safeTier(tier.id, tier.principal_fen, tier.gift_fen)
  ))
}
```

- [ ] **Step 4: Run the resolver tests and verify GREEN**

Run:

```powershell
corepack pnpm vitest run apps/api/src/recharge-gift-rules.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing service/contract tests**

Change the existing configuration test to await the result and require tiers:

```ts
it('exposes the payment mode and current applicable gift tiers', async () => {
  const { pool } = fakePool((sql) => {
    if (sql.includes('cloud_merchant_business_template')) return []
    if (sql.includes('cloud_recharge_gift_tier')) {
      return [
        { id: 'tier-300', principal_fen: 30_000, gift_fen: 2_000 },
        { id: 'tier-500', principal_fen: 50_000, gift_fen: 5_000 }
      ]
    }
    return []
  })
  const service = new MemberRechargeService(
    pool,
    realPaymentProvider(),
    apiConfig()
  )

  await expect(service.getConfiguration(principal())).resolves.toEqual({
    providerMode: 'wechat',
    testAmountFen: 1,
    giftTiers: [
      { principalFen: 30_000, giftFen: 2_000 },
      { principalFen: 50_000, giftFen: 5_000 }
    ]
  })
})
```

Extend the existing “freezes the maximum gift calculation” test so its template response is used by both configuration and order creation, and assert the snapshot contains those exact tier IDs and literal gift allocation.

- [ ] **Step 6: Run service tests and verify RED**

Run:

```powershell
corepack pnpm vitest run apps/api/src/member-recharge.service.test.ts
```

Expected: FAIL because the configuration lacks `giftTiers` and the service still contains duplicate rule SQL.

- [ ] **Step 7: Extend the contract and reuse the resolver**

Add `giftTiers` to `MemberRechargeConfiguration`. Make `getConfiguration()` async, call `resolveRechargeGiftRules(this.pool, principal.tenantId, principal.storeId)`, and return public tier amounts without IDs.

Inside `createOrder()`, replace both existing tier queries and the inline template merge with:

```ts
const resolvedTiers = await resolveRechargeGiftRules(
  client,
  principal.tenantId,
  principal.storeId
)
const domainTiers: RechargeGiftTier[] = resolvedTiers.map((tier) => ({
  id: tier.id,
  principal: nonNegativeFen(tier.principalFen),
  gift: nonNegativeFen(tier.giftFen)
}))
```

Build `gift_rule_snapshot_json.tiers` from `resolvedTiers`. Leave the one-cent isolated-test override intact for the existing test deployment.

- [ ] **Step 8: Run focused and type tests**

Run:

```powershell
corepack pnpm vitest run apps/api/src/recharge-gift-rules.test.ts apps/api/src/member-recharge.service.test.ts
corepack pnpm --filter @zyapp/api typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 9: Commit**

```powershell
git add packages/contracts/src/index.ts apps/api/src/recharge-gift-rules.ts apps/api/src/recharge-gift-rules.test.ts apps/api/src/member-recharge.service.ts apps/api/src/member-recharge.service.test.ts
git commit -m "feat: expose authoritative recharge gift rules"
```

---

### Task 2: Add a Pure Miniapp Gift Estimate Boundary

**Files:**
- Create: `apps/miniapp/src/services/recharge-gift.ts`
- Create: `apps/miniapp/src/services/recharge-gift.test.ts`
- Modify: `apps/miniapp/package.json`
- Modify: `apps/miniapp/src/services/mock-client.ts:424`
- Modify: `apps/miniapp/src/services/mock-client.test.ts:55-90`

**Interfaces:**
- Consumes: `MemberRechargeConfiguration['giftTiers']`.
- Produces:

```ts
export type RechargeGiftTierInput = {
  principalFen: number
  giftFen: number
}

export function calculateRechargeGift(
  principalFen: number,
  tiers: RechargeGiftTierInput[]
): number

export function formatRechargeRuleContent(
  tiers: RechargeGiftTierInput[]
): string
```

- [ ] **Step 1: Write failing table-driven tests**

Create `apps/miniapp/src/services/recharge-gift.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  calculateRechargeGift,
  formatRechargeRuleContent
} from './recharge-gift'

const defaultTiers = [
  { principalFen: 30_000, giftFen: 2_000 },
  { principalFen: 50_000, giftFen: 5_000 },
  { principalFen: 100_000, giftFen: 20_000 }
]

describe('recharge gift preview', () => {
  it.each([
    [10_000, 0],
    [30_000, 2_000],
    [50_000, 5_000],
    [99_900, 5_000],
    [100_000, 20_000],
    [130_000, 22_000]
  ])('previews %i fen as %i gift fen', (principalFen, giftFen) => {
    expect(calculateRechargeGift(principalFen, defaultTiers)).toBe(giftFen)
  })

  it('returns zero when the server reports no active gift rules', () => {
    expect(calculateRechargeGift(100_000, [])).toBe(0)
  })

  it('formats the current rule list and calculation explanation', () => {
    expect(formatRechargeRuleContent(defaultTiers)).toBe(
      '充 ¥300 赠 ¥20\\n充 ¥500 赠 ¥50\\n充 ¥1000 赠 ¥200\\n\\n达到最高档后可重复计算；余数最多再匹配一个档位。最终赠送以创建订单时服务端返回结果为准。'
    )
  })

  it('describes an empty rule set without inventing defaults', () => {
    expect(formatRechargeRuleContent([])).toBe(
      '当前暂无赠送规则。最终赠送以创建订单时服务端返回结果为准。'
    )
  })
})
```

- [ ] **Step 2: Add the test file to the miniapp test command and verify RED**

Append `apps/miniapp/src/services/recharge-gift.test.ts` to the explicit Vitest file list in `apps/miniapp/package.json`.

Run:

```powershell
corepack pnpm miniapp:test
```

Expected: FAIL because `./recharge-gift` does not exist.

- [ ] **Step 3: Implement the pure helper**

Create `apps/miniapp/src/services/recharge-gift.ts`. Normalize the input by keeping only safe integer tiers with positive principal, non-negative gift, unique principal values, and ascending principal. Implement the existing highest-tier repetition algorithm exactly:

```ts
export function calculateRechargeGift(
  principalFen: number,
  inputTiers: RechargeGiftTierInput[]
): number {
  if (!Number.isSafeInteger(principalFen) || principalFen <= 0) return 0
  const tiers = normalizedTiers(inputTiers)
  const highest = tiers[tiers.length - 1]
  if (!highest) return 0

  let remainderFen = principalFen
  let giftFen = 0
  if (remainderFen >= highest.principalFen) {
    const count = Math.floor(remainderFen / highest.principalFen)
    giftFen += count * highest.giftFen
    remainderFen -= count * highest.principalFen
  }
  const remainderTier = [...tiers]
    .reverse()
    .find((tier) => tier.principalFen <= remainderFen)
  return giftFen + (remainderTier?.giftFen ?? 0)
}
```

Use a local integer-fen formatter for the exact modal copy in the test.

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run:

```powershell
corepack pnpm vitest run apps/miniapp/src/services/recharge-gift.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write a failing Mock client contract test**

Add:

```ts
it('returns the actual active gift tiers in recharge configuration', async () => {
  await expect(client.getRechargeConfiguration()).resolves.toEqual({
    providerMode: 'mock',
    testAmountFen: null,
    giftTiers: [
      { principalFen: 30_000, giftFen: 2_000 },
      { principalFen: 50_000, giftFen: 5_000 },
      { principalFen: 100_000, giftFen: 20_000 }
    ]
  })
})
```

Run:

```powershell
corepack pnpm vitest run apps/miniapp/src/services/mock-client.test.ts
```

Expected: FAIL because the Mock response lacks `giftTiers`.

- [ ] **Step 6: Return Mock active tiers**

Change `MockMiniappClient.getRechargeConfiguration()` to map `activeRechargeGiftTiers` into public `{ principalFen, giftFen }` values rather than deriving them from public activities.

- [ ] **Step 7: Run miniapp tests**

Run:

```powershell
corepack pnpm miniapp:test
corepack pnpm miniapp:typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/miniapp/package.json apps/miniapp/src/services/recharge-gift.ts apps/miniapp/src/services/recharge-gift.test.ts apps/miniapp/src/services/mock-client.ts apps/miniapp/src/services/mock-client.test.ts
git commit -m "feat: calculate miniapp recharge gift estimates"
```

---

### Task 3: Render Estimated Gift and Current Rule Modal

**Files:**
- Modify: `apps/miniapp/src/pages/home/index.ts:38-224,326-657`
- Modify: `apps/miniapp/src/pages/home/index.wxml:125-153`
- Modify: `apps/miniapp/src/pages/home/index.wxss:268-348`

**Interfaces:**
- Consumes:

```ts
calculateRechargeGift(principalFen, configuration.giftTiers)
formatRechargeRuleContent(configuration.giftTiers)
```

- Produces page method:

```ts
showRechargeRules(): void
```

- [ ] **Step 1: Make the current build fail against the new contract**

Remove `PublicActivitySummary` from recharge package generation and change the desired call sites to:

```ts
rechargePackages: buildRechargePackages(rechargeConfiguration)
```

Run:

```powershell
corepack pnpm miniapp:typecheck
```

Expected: FAIL because `buildRechargePackages` still requires activities.

- [ ] **Step 2: Replace activity-derived estimates**

Delete `rechargeTiers()` and `giftFor()` from `pages/home/index.ts`. Import the pure helper and change regular package creation to:

```ts
function buildRegularRechargePackages(
  configuration: MemberRechargeConfiguration
): RechargePackageView[] {
  return quickRechargeFen.map((principalFen) => {
    const giftFen = calculateRechargeGift(
      principalFen,
      configuration.giftTiers
    )
    return {
      id: `recharge-${principalFen}`,
      label: `预计赠送 ${formatMoney(giftFen)}`,
      principalFen,
      priceText: formatMoney(principalFen),
      giftText: formatMoney(giftFen),
      totalText: `预计到账 ${formatMoney(principalFen + giftFen)}`
    }
  })
}
```

Keep the one-cent package only when the isolated test API explicitly returns `testAmountFen === 1`; it must remain absent in formal production.

Add page state:

```ts
rechargeRuleContent: ''
```

Whenever configuration is loaded, set:

```ts
rechargeRuleContent: formatRechargeRuleContent(
  rechargeConfiguration.giftTiers
)
```

Add:

```ts
showRechargeRules() {
  wx.showModal({
    title: '当前充赠规则',
    content: this.data.rechargeRuleContent,
    showCancel: false,
    confirmText: '知道了'
  })
}
```

- [ ] **Step 3: Update WXML**

Each package card must render:

```xml
<text class="package-label">{{item.label}}</text>
<text class="package-price">{{item.priceText}}</text>
<text class="package-total">{{item.totalText}}</text>
```

Immediately below the grid add:

```xml
<view class="recharge-rule-note">
  <text>实际赠送以创建充值订单时的规则为准</text>
  <button
    class="recharge-rule-info"
    aria-label="查看当前充赠规则"
    bindtap="showRechargeRules"
  >!</button>
</view>
```

- [ ] **Step 4: Add accessible styling**

Add a horizontally centered muted note. Give `.recharge-rule-info` a minimum `48rpx × 48rpx` hit target, circular border, transparent background, zero external margin, centered `!`, and remove the default pseudo-element border:

```css
.recharge-rule-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  margin-top: 16rpx;
  color: #767168;
  font-size: 21rpx;
}

.recharge-rule-info {
  display: flex;
  width: 48rpx;
  min-width: 48rpx;
  height: 48rpx;
  margin: 0;
  border: 1rpx solid #9a6f16;
  border-radius: 50%;
  padding: 0;
  align-items: center;
  justify-content: center;
  color: #9a6f16;
  background: transparent;
  font-size: 24rpx;
  font-weight: 900;
  line-height: 46rpx;
}

.recharge-rule-info::after {
  border: 0;
}
```

- [ ] **Step 5: Verify the miniapp**

Run:

```powershell
corepack pnpm miniapp:typecheck
corepack pnpm miniapp:test
corepack pnpm miniapp:build
```

Expected: PASS; Mock build completes and no package uses public activities as its gift source.

- [ ] **Step 6: Commit**

```powershell
git add apps/miniapp/src/pages/home/index.ts apps/miniapp/src/pages/home/index.wxml apps/miniapp/src/pages/home/index.wxss
git commit -m "feat: show recharge gift preview and rules"
```

---

### Task 4: Add a Fail-Closed Formal Miniapp Build

**Files:**
- Modify: `apps/miniapp/scripts/build-configuration.test.mjs`
- Modify: `apps/miniapp/scripts/build-configuration.mjs`
- Modify: `apps/miniapp/src/services/build-config.d.ts`
- Modify: `config/public-endpoints.example.json`
- Modify: `apps/miniapp/README.md`

**Interfaces:**
- Consumes public endpoint keys:

```json
{
  "miniappProductionApiBaseUrl": "https://judian.icu",
  "miniappProductionStoreId": ""
}
```

- Produces build mode: `production-wechat`.

- [ ] **Step 1: Write failing production build tests**

Add:

```js
test('builds the customer-only formal production miniapp', () => {
  const result = readBuildConfiguration(
    {
      ZYAPP_MINIAPP_MODE: 'production-wechat',
      ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED: 'false'
    },
    {
      miniappProductionApiBaseUrl: 'https://judian.icu',
      miniappProductionStoreId: '22222222-2222-4222-8222-222222222222'
    }
  )

  assert.deepEqual(result.configuration, {
    useMock: false,
    testVirtualPhoneEnabled: false,
    authMode: 'wechat',
    apiBaseUrl: 'https://judian.icu',
    storeId: '22222222-2222-4222-8222-222222222222',
    developmentProviderSubject: '',
    customerOnly: true,
    realWechatPayment: true
  })
})
```

Add table-driven rejection tests for:

- `https://judian.icu/test`
- `https://124.220.69.209`
- `http://judian.icu`
- missing formal store ID
- `ZYAPP_MINIAPP_AUTH_MODE=development`
- `ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED=true`
- a configuration containing only test endpoint/store fields

- [ ] **Step 2: Run build configuration tests and verify RED**

Run:

```powershell
node apps/miniapp/scripts/build-configuration.test.mjs
```

Expected: FAIL because `production-wechat` is not an allowed mode.

- [ ] **Step 3: Implement the production mode**

In `readBuildConfiguration()`:

```js
const productionTest = mode === 'production-test-wechat'
const production = mode === 'production-wechat'
const strictWechat = productionTest || production
```

Add `production-wechat` to the allowed list. Use production endpoint keys only for production defaults:

```js
const defaultApiBaseUrl = production
  ? publicEndpoints.miniappProductionApiBaseUrl?.trim() || ''
  : mode === 'test-wechat' || productionTest
    ? publicEndpoints.miniappTestApiBaseUrl?.trim() || ''
    : ''

const defaultStoreId = production
  ? publicEndpoints.miniappProductionStoreId?.trim() || ''
  : publicEndpoints.miniappTestStoreId?.trim() || ''
```

Enforce:

```js
if (production && apiBaseUrl !== 'https://judian.icu') {
  throw new Error('production-wechat must use https://judian.icu')
}
if (strictWechat && authMode !== 'wechat') {
  throw new Error(`${mode} mode must use WeChat authentication`)
}
if (testVirtualPhoneEnabled && strictWechat) {
  throw new Error(`${mode} forbids virtual phone login`)
}
```

Set `developmentProviderSubject: ''`, `customerOnly: true`, and `realWechatPayment: true` for both strict WeChat modes. Require an explicit production store ID and do not fall back to test fields.

- [ ] **Step 4: Run build configuration tests and verify GREEN**

Run:

```powershell
node apps/miniapp/scripts/build-configuration.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Update public configuration docs**

Add empty `miniappProductionApiBaseUrl` and `miniappProductionStoreId` fields to `config/public-endpoints.example.json`.

Document this exact build in `apps/miniapp/README.md`:

```powershell
$env:ZYAPP_MINIAPP_MODE='production-wechat'
$env:ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED='false'
$env:ZYAPP_MINIAPP_API_BASE_URL='https://judian.icu'
$env:ZYAPP_MINIAPP_STORE_ID=$formalStoreId
corepack pnpm miniapp:build
```

In the README, define `$formalStoreId` as the value obtained from the read-only production database query before showing this command, and state that the command must not use `/test`.

- [ ] **Step 6: Run typecheck, tests, and a formal build with a fixture UUID**

Run:

```powershell
corepack pnpm miniapp:typecheck
corepack pnpm miniapp:test
$env:ZYAPP_MINIAPP_MODE='production-wechat'
$env:ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED='false'
$env:ZYAPP_MINIAPP_API_BASE_URL='https://judian.icu'
$env:ZYAPP_MINIAPP_STORE_ID='22222222-2222-4222-8222-222222222222'
corepack pnpm miniapp:build
Remove-Item Env:\ZYAPP_MINIAPP_MODE
Remove-Item Env:\ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED
Remove-Item Env:\ZYAPP_MINIAPP_API_BASE_URL
Remove-Item Env:\ZYAPP_MINIAPP_STORE_ID
```

Expected: PASS; `dist/app.json` contains customer routes only.

- [ ] **Step 7: Restore the default Mock artifact**

Run:

```powershell
$env:ZYAPP_MINIAPP_MODE='mock'
corepack pnpm miniapp:build
Remove-Item Env:\ZYAPP_MINIAPP_MODE
```

Expected: PASS; the working `dist/` is no longer a formal artifact until deployment readiness is confirmed.

- [ ] **Step 8: Commit**

```powershell
git add apps/miniapp/scripts/build-configuration.mjs apps/miniapp/scripts/build-configuration.test.mjs apps/miniapp/src/services/build-config.d.ts config/public-endpoints.example.json apps/miniapp/README.md
git commit -m "feat: add formal miniapp production build"
```

---

### Task 5: Enable Formal WeChat Pay Without Test Fallbacks

**Files:**
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/config.ts:150-230`
- Modify: `infra/deploy/compose.production.yml:71-109`
- Modify: `infra/deploy/production.env.example`

**Interfaces:**
- Production API configuration:

```text
DEPLOYMENT_ENVIRONMENT=production
WECHAT_PAYMENT_MODE=wechat
WECHAT_PAY_NOTIFY_URL=https://judian.icu/v1/payments/wechat/recharge/notify
WECHAT_PAY_OUT_TRADE_NO_PREFIX=ZYP-
WECHAT_PAYMENT_TEST_AMOUNT_FEN is absent
```

- [ ] **Step 1: Write failing production configuration tests**

Add:

```ts
it('accepts formal WeChat Pay only with the production notification URL', () => {
  const config = readApiConfig(
    completeWechatEnvironment({
      DEPLOYMENT_ENVIRONMENT: 'production',
      WECHAT_PAY_NOTIFY_URL:
        'https://judian.icu/v1/payments/wechat/recharge/notify',
      WECHAT_PAY_OUT_TRADE_NO_PREFIX: 'ZYP-',
      WECHAT_PAYMENT_TEST_AMOUNT_FEN: undefined
    })
  )

  expect(config.wechatPaymentMode).toBe('wechat')
  expect(config.wechatPaymentTestAmountFen).toBeNull()
  expect(config.wechatPayNotifyUrl).toBe(
    'https://judian.icu/v1/payments/wechat/recharge/notify'
  )
})

it.each([
  'https://judian.icu/test/v1/payments/wechat/recharge/notify',
  'https://124.220.69.209/v1/payments/wechat/recharge/notify'
])('rejects production notification URL %s', (url) => {
  expect(() => readApiConfig(
    completeWechatEnvironment({
      DEPLOYMENT_ENVIRONMENT: 'production',
      WECHAT_PAY_NOTIFY_URL: url,
      WECHAT_PAYMENT_TEST_AMOUNT_FEN: undefined
    })
  )).toThrow(/Production WECHAT_PAY_NOTIFY_URL/)
})
```

- [ ] **Step 2: Run configuration tests and verify RED**

Run:

```powershell
corepack pnpm vitest run apps/api/src/config.test.ts
```

Expected: FAIL because production notification URLs are not yet constrained.

- [ ] **Step 3: Add environment-specific notification validation**

Keep the existing exact test URL check and add:

```ts
if (
  wechatPayNotifyUrl &&
  deploymentEnvironment === 'production' &&
  wechatPayNotifyUrl !==
    'https://judian.icu/v1/payments/wechat/recharge/notify'
) {
  throw new Error(
    'Production WECHAT_PAY_NOTIFY_URL must be https://judian.icu/v1/payments/wechat/recharge/notify'
  )
}
```

- [ ] **Step 4: Run configuration tests and verify GREEN**

Run:

```powershell
corepack pnpm vitest run apps/api/src/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Enable formal payment in Compose**

In the `api` service add the same server-side payment fields and read-only key mount used by `api-test`, with formal-only values:

```yaml
      WECHAT_PAYMENT_MODE: wechat
      WECHAT_PAY_MERCHANT_ID: ${WECHAT_PAY_MERCHANT_ID:?WECHAT_PAY_MERCHANT_ID is required}
      WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL: ${WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL:?WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL is required}
      WECHAT_PAY_MERCHANT_PRIVATE_KEY_FILE: /run/secrets/wechatpay/apiclient_key.pem
      WECHAT_PAY_PUBLIC_KEY_ID: ${WECHAT_PAY_PUBLIC_KEY_ID:?WECHAT_PAY_PUBLIC_KEY_ID is required}
      WECHAT_PAY_PUBLIC_KEY_FILE: /run/secrets/wechatpay/wechatpay_public_key.pem
      WECHAT_PAY_API_V3_KEY_FILE: /run/secrets/wechatpay/apiv3.key
      WECHAT_PAY_NOTIFY_URL: https://judian.icu/v1/payments/wechat/recharge/notify
      WECHAT_PAY_OUT_TRADE_NO_PREFIX: ZYP-
```

Do not add `WECHAT_PAYMENT_TEST_AMOUNT_FEN` to `api`. Add:

```yaml
    volumes:
      - ./updates/production/windows:/app/updates/windows:ro
      - ${WECHATPAY_SECRETS_DIRECTORY:-/opt/zyapp/secrets/wechatpay}:/run/secrets/wechatpay:ro
```

Keep the test API on `/test`, `ZYT-`, and one cent.

- [ ] **Step 6: Update the environment example**

Document separate switches:

```dotenv
WECHAT_PAYMENT_MODE=wechat
TEST_WECHAT_PAYMENT_MODE=wechat
```

Keep real secrets as replacement markers. Explain in comments or README prose that production Compose fixes the root notification URL and `ZYP-`, while test fixes `/test`, `ZYT-`, and one cent.

- [ ] **Step 7: Validate Compose interpolation without printing secrets**

Use the existing local environment file only as input and discard rendered output:

```powershell
docker compose --env-file infra/deploy/production.env.before-domain-20260725 -f infra/deploy/compose.production.yml config --quiet
```

If the historical file lacks required modern payment variables, run the same validation against the current server environment during Task 6; do not print or copy missing values into the chat.

Expected: exit 0, or a precise missing-variable failure that Task 6 must resolve from the existing server environment.

- [ ] **Step 8: Run API tests and build**

Run:

```powershell
corepack pnpm vitest run apps/api/src/config.test.ts apps/api/src/member-recharge.service.test.ts apps/api/src/wechat-payment.controller.test.ts apps/api/src/wechatpay-provider.test.ts
corepack pnpm --filter @zyapp/api typecheck
corepack pnpm cloud:build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add apps/api/src/config.ts apps/api/src/config.test.ts infra/deploy/compose.production.yml infra/deploy/production.env.example
git commit -m "ops: enable formal miniapp WeChat payment"
```

---

### Task 6: Add a Production-Only Deployment Guard

**Files:**
- Create: `infra/scripts/deploy-miniapp-production.ps1`

**Interfaces:**
- Inputs:

```powershell
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-zA-Z0-9.-]+$')]
  [string]$HostName,
  [string]$SshUser = 'ubuntu',
  [Parameter(Mandatory = $true)]
  [string]$KeyPath,
  [string]$RemoteDirectory = '/opt/zyapp',
  [switch]$ValidateOnly
)
```

- Uses the existing server `/opt/zyapp/infra/deploy/production.env` and `/opt/zyapp/secrets/wechatpay`; it never downloads, prints, or replaces them.
- Produces a production database backup, a rebuilt formal API, formal health output, and read-only store/rule rows.

- [ ] **Step 1: Verify the absent script fails**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File infra/scripts/deploy-miniapp-production.ps1 -HostName 124.220.69.209 -KeyPath C:\Users\泉\.ssh\id_rsa -ValidateOnly
```

Expected: FAIL because the script does not exist.

- [ ] **Step 2: Implement local validation and safe archive creation**

The script must:

1. Resolve and validate the SSH key.
2. Require `ssh`, `scp`, and `tar`.
3. Validate `RemoteDirectory` against `^/[a-zA-Z0-9._/-]+$`.
4. Create only `E:\AIproject\zyApp\.tmp\miniapp-production-deploy`.
5. Verify the archive path remains inside that directory.
6. Exclude `.git`, `.worktrees`, `node_modules`, `.tmp`, `outputs`, `legacy-data`, every `infra/deploy/*.env*`, `secrets`, and certificate-named files.
7. With `-ValidateOnly`, print `Production miniapp deployment inputs are valid.` and exit before SSH or mutation.

Use native `Remove-Item -LiteralPath` only after the resolved archive containment check.

- [ ] **Step 3: Verify local validation passes**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File infra/scripts/deploy-miniapp-production.ps1 -HostName 124.220.69.209 -KeyPath C:\Users\泉\.ssh\id_rsa -ValidateOnly
```

Expected: `Production miniapp deployment inputs are valid.`

- [ ] **Step 4: Implement the remote preflight**

Before uploading or changing services, run read-only checks that:

- `/opt/zyapp/infra/deploy/production.env` exists and is mode `0600`.
- `/opt/zyapp/secrets/wechatpay` exists and contains readable `apiclient_key.pem`, `wechatpay_public_key.pem`, and `apiv3.key`.
- The server environment defines non-empty `WECHAT_PAY_MERCHANT_ID`, `WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL`, `WECHAT_PAY_PUBLIC_KEY_ID`, `WECHAT_MINIAPP_APP_ID`, and `WECHAT_MINIAPP_APP_SECRET`.
- Production and test health endpoints both return HTTP success before deployment.
- Production database contains exactly one intended active store for this single-store release. Print only tenant ID, store ID, and store name.
- The resolved production recharge rule query returns at least one tier. Print only integer principal/gift amounts.

The script must stop before backup or deployment if any preflight fails.

- [ ] **Step 5: Implement backup and deployment**

Upload only the sanitized source archive and a generated remote shell script to `/tmp/zyapp-miniapp-production`. The remote script must:

```sh
set -euo pipefail
trap 'rm -rf /tmp/zyapp-miniapp-production' EXIT
cd /opt/zyapp
sudo BACKUP_ENVIRONMENTS=production DEPLOY_DIR=/opt/zyapp \
  bash infra/deploy/backup-postgres.sh
sudo docker compose --env-file infra/deploy/production.env \
  -f infra/deploy/compose.production.yml build --no-cache migrate api
sudo docker compose --env-file infra/deploy/production.env \
  -f infra/deploy/compose.production.yml run --rm --no-deps migrate
sudo docker compose --env-file infra/deploy/production.env \
  -f infra/deploy/compose.production.yml up -d --no-deps \
  --force-recreate api caddy
```

After deployment, poll both root and `/test` health for at most 180 seconds. Verify:

- root health succeeds;
- test health remains successful;
- production migration equals the newest repository migration;
- the latest production backup and `.sha256` exist and are non-empty;
- `api` reports `DEPLOYMENT_ENVIRONMENT=production`, `WECHAT_PAYMENT_MODE=wechat`, the root notification URL, prefix `ZYP-`, and no `WECHAT_PAYMENT_TEST_AMOUNT_FEN`;
- `api-test` still reports test deployment, `/test` notification URL, prefix `ZYT-`, and test amount `1`;
- no environment value or key content is printed.

- [ ] **Step 6: Parse-check the script**

Run:

```powershell
$errors = $null
[Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path 'infra/scripts/deploy-miniapp-production.ps1'),
  [ref]$null,
  [ref]$errors
) | Out-Null
if ($errors.Count -gt 0) { throw ($errors | Out-String) }
```

Expected: no parser errors.

- [ ] **Step 7: Commit**

```powershell
git add infra/scripts/deploy-miniapp-production.ps1
git commit -m "ops: guard formal miniapp production deployment"
```

---

### Task 7: Verify, Deploy, Build the Formal Artifact, and Document Owner Gates

**Files:**
- Modify: `config/public-endpoints.local.json` (Git-ignored local configuration; never commit)
- Modify: `docs/人工验收计划.md`
- Modify: `docs/开发任务路线图-v1.md`

**Interfaces:**
- Consumes the formal store UUID emitted by Task 6 preflight.
- Produces `apps/miniapp/dist` in `production-wechat` mode and a healthy formal API.

- [ ] **Step 1: Run the full pre-deployment verification**

Run:

```powershell
corepack pnpm miniapp:typecheck
corepack pnpm miniapp:test
corepack pnpm test -- apps/api/src/recharge-gift-rules.test.ts apps/api/src/member-recharge.service.test.ts apps/api/src/config.test.ts apps/api/src/wechat-payment.controller.test.ts apps/api/src/wechatpay-provider.test.ts
corepack pnpm typecheck
corepack pnpm cloud:build
```

Expected: all commands pass with no warnings that indicate disabled or Mock formal payment.

- [ ] **Step 2: Run production preflight**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File infra/scripts/deploy-miniapp-production.ps1 -HostName 124.220.69.209 -KeyPath C:\Users\泉\.ssh\id_rsa -ValidateOnly
```

Then run the script without `-ValidateOnly`. Stop if it reports multiple stores, no active rule, missing keys, unhealthy test API, or any environment mismatch.

- [ ] **Step 3: Confirm the production backup before continuing**

Record only:

- backup filename;
- backup byte length;
- SHA-256 verification success;
- migration number;
- formal tenant ID and store ID;
- resolved integer gift tiers.

Do not record database URLs, passwords, AppSecret, certificate serial beyond the already-public configured identifier, or key content.

- [ ] **Step 4: Write the formal public endpoint values locally**

Load ignored `config/public-endpoints.local.json` as JSON, preserve its existing desktop and test entries, set `miniappProductionApiBaseUrl` to `https://judian.icu`, and set `miniappProductionStoreId` to the exact single UUID returned by the Task 6 preflight. Verify with a local read that prints only endpoint URLs and store IDs.

- [ ] **Step 5: Build the real formal miniapp**

Run:

```powershell
$env:ZYAPP_MINIAPP_MODE='production-wechat'
$env:ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED='false'
corepack pnpm miniapp:build
Remove-Item Env:\ZYAPP_MINIAPP_MODE
Remove-Item Env:\ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED
```

Expected build log: `[miniapp] built production-wechat mode`.

- [ ] **Step 6: Inspect the formal artifact**

Verify:

- `dist/app.json` contains only customer routes;
- generated build configuration uses `https://judian.icu` and the formal store UUID;
- no generated configuration uses `/test`, IP API, development auth, virtual phone, or Mock;
- `rechargeConfiguration.testAmountFen === 1` may remain as dormant source logic but the formal API configuration is `null`, so no one-cent card renders;
- WXML contains the estimated gift labels and rule info control.

Use structured JSON/JavaScript inspection where possible; do not rely only on source-text grep.

- [ ] **Step 7: Verify in WeChat Developer Tools**

Build `dist/`, read `zyapp-miniapp` MCP guidance, connect to Developer Tools, and capture:

- current page;
- console logs;
- screenshot showing formal recharge cards;
- modal screenshot showing current applicable rules.

Do not use `page_setData`, mocked requests, or component setters to claim the formal data flow passed. If real login state is unavailable, label the simulator check as layout-only and leave login/payment to the owner.

- [ ] **Step 8: Update acceptance documentation**

Add a production miniapp section to `docs/人工验收计划.md` with the owner steps from the approved design:

1. upload the formal build as an experience version;
2. real WeChat login and phone authorization;
3. confirm member/balance/history are from the formal database;
4. verify every estimate and the rule modal;
5. confirm a formal WeChat payment amount;
6. complete payment;
7. reconcile merchant order and notification;
8. verify wallet credit exactly once;
9. refresh PC and reconcile recharge order and ledgers.

Update `docs/开发任务路线图-v1.md` to say the formal API/build candidate and automated checks are complete, while experience upload, real payment, merchant reconciliation, PC reconciliation, review, and release remain owner gates. Do not mark real payment or final release complete.

- [ ] **Step 9: Commit documentation**

```powershell
git add docs/人工验收计划.md docs/开发任务路线图-v1.md
git commit -m "docs: add formal miniapp recharge acceptance"
```

- [ ] **Step 10: Run final regression and inspect repository state**

Run:

```powershell
corepack pnpm miniapp:typecheck
corepack pnpm miniapp:test
corepack pnpm test -- apps/api/src/recharge-gift-rules.test.ts apps/api/src/member-recharge.service.test.ts apps/api/src/config.test.ts apps/api/src/wechat-payment.controller.test.ts apps/api/src/wechatpay-provider.test.ts
corepack pnpm typecheck
corepack pnpm cloud:build
git status --short
git log -8 --oneline
```

Expected:

- all checks pass;
- `apps/miniapp/dist` remains the formal `production-wechat` artifact because the user explicitly requested final formal acceptance;
- the only unrelated untracked file remains `infra/deploy/production.env.before-domain-20260725`;
- no secrets or environment files are staged.

## Self-Review Results

- Spec coverage: authoritative rule source, real-time estimate, rule modal, server snapshot authority, formal build, production payment, database separation, backup, rollback, automated verification, simulator verification, and owner-only acceptance all map to Tasks 1–7.
- Scope: API, miniapp, and deployment changes are interdependent parts of one formal recharge release and do not need separate plans.
- Placeholder scan: no implementation step uses `TBD`, `TODO`, “implement later”, or an undefined “similar to” reference.
- Type consistency: `giftTiers`, `ResolvedRechargeGiftTier`, `calculateRechargeGift`, `formatRechargeRuleContent`, `production-wechat`, `miniappProductionApiBaseUrl`, and `miniappProductionStoreId` are named consistently across producers and consumers.
