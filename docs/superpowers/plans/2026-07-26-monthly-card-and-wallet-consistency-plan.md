# 月卡有效期主视觉与账务一致性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布 0.23.2 测试候选版，使已开月卡会员优先看到到期日，并自动恢复被阻塞的 PC 财务同步、修复微信充值镜像与重复账本展示。

**Architecture:** 小程序把月卡展示计算抽成纯函数，WXML 按未开通/已开通/暂停三态渲染。SQLite Schema 29 只修复待同步等级对账的缺失操作人并建立“有效账本”只读视图；云端镜像在写入前识别本机财务操作的确认回声。API 只修正微信充值订单镜像的 PostgreSQL 类型比较，不放宽员工鉴权。

**Tech Stack:** TypeScript、原生微信小程序 WXML/WXSS、Electron、Node `node:sqlite`、NestJS、PostgreSQL、Vitest、Node Test Runner、pnpm 10.12.1。

## Global Constraints

- 目标版本固定为 `0.23.2`，SQLite 最新 Schema 固定为 `29`。
- 金额继续使用整数分；不得直接改写钱包余额或重新执行充值/消费。
- 不删除真实或技术财务记录；现有云端回声只通过只读视图从业务展示和报表中排除。
- 不允许无员工操作人的会员等级业务命令通过云端鉴权。
- PC 和小程序必须继续使用同一测试门店与 `https://judian.icu/test`。
- 只部署测试 API、测试数据库迁移和 PC 测试更新通道。
- 生产 API、生产 Caddy、生产 PC 更新通道、主分支和远程 Git 保持不变。
- 所有生产代码变更必须先有能准确失败的回归测试。

---

### Task 1: 月卡三态展示模型与首页主视觉

**Files:**
- Create: `apps/miniapp/src/services/monthly-card-display.ts`
- Create: `apps/miniapp/src/services/monthly-card-display.test.ts`
- Modify: `apps/miniapp/src/pages/home/index.ts`
- Modify: `apps/miniapp/src/pages/home/index.wxml`
- Modify: `apps/miniapp/src/pages/home/index.wxss`
- Modify: `apps/miniapp/scripts/member-page-layout.test.mjs`
- Modify: `apps/miniapp/package.json`

**Interfaces:**
- Consumes: `MemberSelfServiceSummary`, `MemberMonthlyCardConfiguration`.
- Produces:

```ts
export type MonthlyCardDisplay = {
  state: 'unopened' | 'active' | 'paused'
  actionText: string
  priceText: string
  statusText: string
  expiresOn: string | null
  remainingDaysText: string | null
}

export function monthlyCardDisplay(
  member: MemberSelfServiceSummary,
  configuration: MemberMonthlyCardConfiguration,
  now?: Date
): MonthlyCardDisplay
```

- [ ] **Step 1: Write failing display-model tests**

Create `monthly-card-display.test.ts` with real DTO fixtures. Required assertions:

```ts
expect(monthlyCardDisplay(active, plan, new Date('2026-07-26T00:00:00+08:00')))
  .toMatchObject({
    state: 'active',
    expiresOn: '2026-08-24',
    remainingDaysText: '剩余 29 天',
    actionText: '微信续费'
  })

expect(monthlyCardDisplay(unopened, plan)).toMatchObject({
  state: 'unopened',
  expiresOn: null,
  remainingDaysText: null,
  actionText: '微信开通月卡'
})

expect(monthlyCardDisplay(paused, plan)).toMatchObject({
  state: 'paused',
  expiresOn: '2026-08-24',
  actionText: '暂不可续费'
})
```

Also test same-day expiry as `剩余 0 天` and an already elapsed date clamped to `剩余 0 天`.

- [ ] **Step 2: Extend the layout contract test**

Update `member-page-layout.test.mjs` so the active-state markup must contain:

```js
assert.match(wxml, /class="monthly-card-expiry-date"/)
assert.match(wxml, /{{monthlyCardExpiresOn}}/)
assert.match(wxml, /{{monthlyCardRemainingDaysText}}/)
assert.match(wxml, /class="monthly-card-renew-button"/)
assert.match(wxml, /wx:if="{{monthlyCardState === 'unopened'}}"/)
```

The test must also reject `monthly-card-renew-button` using the existing full-width `monthly-card-button` class.

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
corepack pnpm exec vitest run apps/miniapp/src/services/monthly-card-display.test.ts
node --test apps/miniapp/scripts/member-page-layout.test.mjs
```

Expected: the Vitest file fails because `monthly-card-display.ts` does not exist; the layout test fails because expiry-date and secondary-renew markup are absent.

- [ ] **Step 4: Implement the pure display model**

Use Shanghai natural-day ordinals without depending on `Intl`:

```ts
const DAY_MS = 24 * 60 * 60 * 1000
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

function shanghaiDay(value: Date): number {
  return Math.floor((value.getTime() + SHANGHAI_OFFSET_MS) / DAY_MS)
}

const remainingDays = Math.max(
  0,
  shanghaiDay(new Date(member.monthlyCardExpiresAt!)) - shanghaiDay(now)
)
```

Return the existing large-price copy only for `unopened`. For `active` and `paused`, return `expiresOn` and `remainingDaysText`; keep plan price in `priceText`.

- [ ] **Step 5: Render three explicit states**

In `home/index.ts`, replace the page-local `monthlyCardCopy` calculation with
`monthlyCardDisplay`. Add page data:

```ts
monthlyCardState: 'unopened' as MonthlyCardDisplay['state'],
monthlyCardExpiresOn: null as string | null,
monthlyCardRemainingDaysText: null as string | null
```

In WXML:

- `unopened`: retain large `monthly-card-price` and full-width open button.
- `active`: render `有效期至`, `monthly-card-expiry-date`, remaining-day badge,
  compact plan price, “续费后从当前到期日顺延”, and a small
  `monthly-card-renew-button`.
- `paused`: render the same expiry block, a paused badge, blocked reason, and
  disabled compact button.

Set `.monthly-card-expiry-date` to at least `56rpx`; set the renew button width
to content or at most `240rpx`, with no full-width rule.

- [ ] **Step 6: Add the new test file to the miniapp test script**

Append `apps/miniapp/src/services/monthly-card-display.test.ts` to the Vitest
file list in `apps/miniapp/package.json`.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```powershell
corepack pnpm exec vitest run apps/miniapp/src/services/monthly-card-display.test.ts
node --test apps/miniapp/scripts/member-page-layout.test.mjs
corepack pnpm miniapp:typecheck
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```powershell
git add apps/miniapp
git commit -m "feat: prioritize active monthly card expiry"
```

---

### Task 2: SQLite Schema 29 的同步解阻与有效账本视图

**Files:**
- Modify: `packages/local-db/src/migrations.ts`
- Modify: `packages/local-db/src/local-db.test.ts`

**Interfaces:**
- Consumes: existing `employee`, `outbox_operation`, and `wallet_ledger`.
- Produces: Schema 29 and read-only view `effective_wallet_ledger` with the
  same columns as `wallet_ledger`.

- [ ] **Step 1: Write the failing Schema 28 → 29 migration test**

In `local-db.test.ts`, create a populated v28 database, then insert:

```sql
INSERT INTO outbox_operation
(operation_id, device_id, device_seq, tenant_id, store_id, actor_id,
 operation_type, aggregate_id, base_version, occurred_at, payload_json,
 payload_hash, sync_status)
VALUES (..., NULL, 'member.tier.reconciled', ..., 'pending');
```

Include an active manager and active staff fixture. After the final migration,
assert:

```ts
expect(migrateDatabase(connection)).toBe(29)
expect(repaired.actor_id).toBe(manager.id)
expect(repaired.payload_json).toBe(originalPayload)
expect(repaired.payload_hash).toBe(originalHash)
```

Also insert:

- a confirmed actorless tier operation, which must remain unchanged;
- a pending non-tier operation, which must remain unchanged;
- an existing local ledger row and matching `cloud-sync` echo row.

Assert `wallet_ledger` still contains both rows while
`effective_wallet_ledger` returns only the local original.

- [ ] **Step 2: Add the no-active-employee migration case**

Build another v28 fixture with disabled employees only. After migration,
assert the pending actorless tier operation still has `actor_id = NULL`.

- [ ] **Step 3: Run the migration test and verify RED**

Run:

```powershell
corepack pnpm exec vitest run packages/local-db/src/local-db.test.ts
```

Expected: FAIL because latest schema is 28 and the view does not exist.

- [ ] **Step 4: Add migration 29**

Append:

```sql
UPDATE outbox_operation AS pending
SET actor_id = (
  SELECT employee.id
  FROM employee
  WHERE employee.tenant_id = pending.tenant_id
    AND employee.store_id = pending.store_id
    AND employee.status = 'active'
  ORDER BY CASE employee.role WHEN 'manager' THEN 0 ELSE 1 END,
           employee.updated_at DESC,
           employee.id
  LIMIT 1
)
WHERE pending.sync_status = 'pending'
  AND pending.operation_type = 'member.tier.reconciled'
  AND pending.actor_id IS NULL
  AND EXISTS (
    SELECT 1 FROM employee
    WHERE employee.tenant_id = pending.tenant_id
      AND employee.store_id = pending.store_id
      AND employee.status = 'active'
  );

CREATE VIEW effective_wallet_ledger AS
SELECT cloud_row.*
FROM wallet_ledger cloud_row
WHERE NOT (
  cloud_row.actor_id = 'cloud-sync'
  AND EXISTS (
    SELECT 1
    FROM wallet_ledger local_row
    WHERE local_row.tenant_id = cloud_row.tenant_id
      AND local_row.member_id = cloud_row.member_id
      AND local_row.entry_type = cloud_row.entry_type
      AND local_row.source_id = cloud_row.source_id
      AND local_row.principal_delta_fen = cloud_row.principal_delta_fen
      AND local_row.gift_delta_fen = cloud_row.gift_delta_fen
      AND local_row.actor_id <> 'cloud-sync'
  )
);
```

The view must not use timestamp equality.

- [ ] **Step 5: Update schema expectations**

Change all latest-version assertions from 28 to 29 and assert
`effective_wallet_ledger` exists in `sqlite_master` with `type = 'view'`.

- [ ] **Step 6: Run migration tests and verify GREEN**

Run:

```powershell
corepack pnpm exec vitest run packages/local-db/src/local-db.test.ts
corepack pnpm --filter @zyapp/local-db typecheck
```

Expected: all tests pass and `PRAGMA foreign_key_check` remains empty.

- [ ] **Step 7: Commit**

```powershell
git add packages/local-db/src/migrations.ts packages/local-db/src/local-db.test.ts
git commit -m "fix: repair blocked tier reconciliation outbox"
```

---

### Task 3: 未来等级对账必须携带有效员工

**Files:**
- Modify: `packages/local-db/src/member-tier-reconciliation.ts`
- Modify: `packages/local-db/src/member-tier-reconciliation.test.ts`

**Interfaces:**
- Consumes: local active `employee` records.
- Produces:

```ts
export function ensureMemberTierReconciliationOutbox(
  database: DatabaseSync,
  context: StoreContext
): { created: number }
```

The public signature stays unchanged, but automatically generated operations
must contain the selected employee ID.

- [ ] **Step 1: Strengthen the existing test**

After calling `ensureMemberTierReconciliationOutbox`, select `actor_id` as
well as `payload_json` and assert it equals the fixture manager ID.

Add a fixture with no active employee and assert:

```ts
expect(ensureMemberTierReconciliationOutbox(connection, context))
  .toEqual({ created: 0 })
expect(pendingTierCount).toBe(0)
expect(systemMarkerCount).toBe(0)
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
corepack pnpm exec vitest run packages/local-db/src/member-tier-reconciliation.test.ts
```

Expected: existing code writes `actor_id = NULL` and incorrectly creates
operations without an employee.

- [ ] **Step 3: Select the authorization employee**

Before beginning the transaction, query:

```sql
SELECT *
FROM employee
WHERE tenant_id = ? AND store_id = ? AND status = 'active'
ORDER BY CASE role WHEN 'manager' THEN 0 ELSE 1 END,
         updated_at DESC, id
LIMIT 1
```

Map the row to `EmployeeRecord`. If no row exists, return `{ created: 0 }`
without writing the system marker.

Pass `{ ...context, actor }` to
`appendMemberTierReconciliationInOpenTransaction`, so both audit and outbox
carry the same employee.

- [ ] **Step 4: Run and verify GREEN**

Run:

```powershell
corepack pnpm exec vitest run packages/local-db/src/member-tier-reconciliation.test.ts packages/local-db/src/local-db.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add packages/local-db/src/member-tier-reconciliation.ts packages/local-db/src/member-tier-reconciliation.test.ts
git commit -m "fix: authorize automatic tier reconciliation"
```

---

### Task 4: 微信充值订单镜像类型兼容

**Files:**
- Modify: `apps/api/src/desktop-mirror.service.ts`
- Modify: `apps/api/src/desktop-mirror.service.test.ts`

**Interfaces:**
- Consumes: PostgreSQL `wechat_recharge_order.id UUID` and
  `cloud_wallet_ledger.source_operation_id TEXT`.
- Produces: tenant-wide `wechat_recharge_orders` mirror page with optional
  `wallet_operation_id`.

- [ ] **Step 1: Write a failing SQL contract assertion**

In the WeChat recharge mirror test, assert the generated SQL contains:

```ts
expect(sql).toContain('ledger.source_operation_id = recharge.id::text')
expect(sql).not.toContain('ledger.source_operation_id = recharge.id\n')
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
corepack pnpm exec vitest run apps/api/src/desktop-mirror.service.test.ts
```

Expected: FAIL because the query compares text directly with UUID.

- [ ] **Step 3: Apply the explicit cast**

Change only the join predicate:

```sql
AND ledger.source_operation_id = recharge.id::text
```

Do not cast the ledger column, so an index on the text source remains usable.

- [ ] **Step 4: Run and verify GREEN**

Run:

```powershell
corepack pnpm exec vitest run apps/api/src/desktop-mirror.service.test.ts
corepack pnpm --filter @zyapp/api typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/desktop-mirror.service.ts apps/api/src/desktop-mirror.service.test.ts
git commit -m "fix: cast WeChat recharge mirror identifiers"
```

---

### Task 5: 阻止新账本回声并隐藏现有回声

**Files:**
- Modify: `packages/local-db/src/cloud-mirror-materialization.ts`
- Modify: `packages/local-db/src/cloud-mirror-materialization.test.ts`
- Modify: `packages/local-db/src/wallet.ts`
- Modify: `packages/local-db/src/wallet.test.ts`
- Modify: `packages/local-db/src/reporting.ts`
- Modify: `packages/local-db/src/reporting.test.ts`

**Interfaces:**
- Consumes: Schema 29 view `effective_wallet_ledger`.
- Produces: wallet detail and business report data with each business movement
  counted once.

- [ ] **Step 1: Write a failing cloud-echo materialization test**

Create a real local cash recharge, capture its ledger `source_id` and deltas,
then apply a `wallet_ledger` cloud page with a different `operation_id` but the
same event type, member, source and deltas.

Assert:

```ts
expect(
  connection.prepare(
    `SELECT COUNT(*) count FROM wallet_ledger
     WHERE member_id = ? AND source_id = ?`
  ).get(member.id, sourceId)
).toEqual({ count: 1 })
```

Then apply a WeChat recharge with a new source ID and assert it is inserted,
proving other-device and miniapp records are not suppressed.

- [ ] **Step 2: Write failing existing-echo display and report tests**

In `wallet.test.ts`, insert a matching `cloud-sync` echo row alongside a real
local debit and assert `getWalletDetails(...).ledger` contains the movement
once.

In `reporting.test.ts`, insert a matching cloud echo for a local
`consumption_debit` and assert `report.wallet.consumptionDebitFen` is unchanged.
Also assert the raw `wallet_ledger` count remains 2.

- [ ] **Step 3: Run and verify RED**

Run:

```powershell
corepack pnpm exec vitest run packages/local-db/src/cloud-mirror-materialization.test.ts packages/local-db/src/wallet.test.ts packages/local-db/src/reporting.test.ts
```

Expected: materialization creates a second row; wallet detail and report count
the echo twice.

- [ ] **Step 4: Suppress new local-operation echoes**

In `applyWalletLedger`, map `event_type` to `entry_type`, read
`source_operation_id`, principal delta and gift delta once, then check:

```sql
SELECT 1
FROM wallet_ledger
WHERE tenant_id = ?
  AND member_id = ?
  AND entry_type = ?
  AND source_id = ?
  AND principal_delta_fen = ?
  AND gift_delta_fen = ?
  AND actor_id <> 'cloud-sync'
LIMIT 1
```

Return before insertion when the query matches. Keep the existing
`operation_id` idempotency check first.

- [ ] **Step 5: Read business views from the effective view**

Change only business-display and aggregation reads:

```sql
FROM effective_wallet_ledger
```

Use it in `wallet.ts` `listLedger` and `reporting.ts` wallet debit/refund
aggregation. Do not replace ledger reads used for refund linkage, allocation,
idempotency, or diagnostics.

- [ ] **Step 6: Run and verify GREEN**

Run:

```powershell
corepack pnpm exec vitest run packages/local-db/src/cloud-mirror-materialization.test.ts packages/local-db/src/wallet.test.ts packages/local-db/src/reporting.test.ts
corepack pnpm --filter @zyapp/local-db typecheck
```

Expected: all tests pass and raw rows remain available.

- [ ] **Step 7: Commit**

```powershell
git add packages/local-db/src
git commit -m "fix: deduplicate confirmed wallet mirror echoes"
```

---

### Task 6: 0.23.2 发布元数据与完整验证

**Files:**
- Modify: `package.json`
- Modify: `apps/merchant-desktop/package.json`
- Modify: `apps/merchant-desktop/release-notes.md`
- Modify: `apps/miniapp/README.md`
- Create: `docs/0.23.2月卡与账务一致性验收.md`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: versioned test candidate and acceptance checklist.

- [ ] **Step 1: Update version and release notes**

Set root and desktop versions to `0.23.2`. Add release notes covering:

- active monthly-card expiry emphasis;
- automatic recovery of blocked PC sync;
- WeChat recharge mirror fix;
- wallet echo deduplication without deleting raw records;
- test-channel-only release.

- [ ] **Step 2: Add the acceptance document**

Record exact automated commands and manual checks:

- active member sees a large expiry date and compact renewal;
- PC pending operations reach zero after update;
- affected member becomes 120.02 yuan on PC and cloud after all existing
  operations confirm;
- latest cash recharge, consumption and 0.01-yuan WeChat recharge are each
  shown once;
- test version is 0.23.2 and production remains unchanged.

- [ ] **Step 3: Run fresh full verification**

Run sequentially:

```powershell
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm --filter @zyapp/miniapp test
git diff --check
```

Expected: every command exits 0 with no failed tests.

- [ ] **Step 4: Build the isolated experience miniapp**

Using ignored local public endpoint configuration:

```powershell
$config = Get-Content -Raw -Encoding UTF8 E:\AIproject\zyApp\config\public-endpoints.local.json | ConvertFrom-Json
$env:ZYAPP_MINIAPP_MODE='production-test-wechat'
$env:ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED='false'
$env:ZYAPP_MINIAPP_API_BASE_URL=$config.miniappTestApiBaseUrl
$env:ZYAPP_MINIAPP_STORE_ID=$config.miniappTestStoreId
corepack pnpm miniapp:build
```

Expected: output states `built production-test-wechat mode`.

- [ ] **Step 5: Prepare the Windows release**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File infra/scripts/prepare-desktop-release.ps1
```

Expected: manifest version 0.23.2 and installer SHA-256 generated.

- [ ] **Step 6: Commit the verified candidate**

```powershell
git add package.json apps packages
git add -f docs/0.23.2月卡与账务一致性验收.md
git commit -m "chore: prepare 0.23.2 test candidate"
```

Do not push.

---

### Task 7: 隔离测试部署与现场数据核对

**Files:**
- No source changes expected.
- Generated: `apps/miniapp/dist`
- Generated: `apps/merchant-desktop/dist-installer`

**Interfaces:**
- Consumes: committed 0.23.2 candidate.
- Produces: healthy test API, test DB migration 18, PC test update 0.23.2,
  and reconciled device sequence 30.

- [ ] **Step 1: Record production and test baselines**

Read and save:

- production API container ID;
- Caddy container ID;
- production Windows release-manifest SHA-256;
- production and test update versions;
- current test database migration version;
- current PC pending sequence range and affected member balances.

- [ ] **Step 2: Deploy test API only**

Run `infra/scripts/deploy-miniapp-production-test.ps1` with the existing SSH key,
ignored environment file, APIv3 key, merchant certificate/private key and
WeChat Pay public key paths. Never run the production deployment script.

Expected: migration remains/currently becomes 18, test health is 200, and
production container IDs remain unchanged.

- [ ] **Step 3: Deploy PC test release**

Run `infra/scripts/deploy-test-release.ps1` with the existing SSH key and
ignored environment file.

Expected:

```text
Test release healthy: test=0.23.2 migration=18 production=0.22.3
```

- [ ] **Step 4: Update the PC and observe automatic recovery**

Install the 0.23.2 test-channel update through the PC updater. Do not edit the
SQLite database manually. Wait until:

```sql
SELECT COUNT(*) FROM outbox_operation WHERE sync_status <> 'confirmed';
```

returns 0 and `sync_state.last_confirmed_device_seq` is at least 30.

- [ ] **Step 5: Reconcile PC, cloud and miniapp data**

Verify the affected member:

- cloud and PC total balance are both 120.02 yuan after existing operations;
- the 100-yuan cash recharge appears once;
- the 40-yuan stored-value consumption appears once;
- the 0.01-yuan WeChat recharge appears once;
- miniapp history includes PC offline cash recharge and consumption;
- PC transaction page refreshes WeChat orders without API 500.

- [ ] **Step 6: Re-check production isolation**

Confirm production API/Caddy IDs and production manifest SHA-256 equal Step 1,
production health is 200, production update is still 0.22.3, and no Git push
occurred.

- [ ] **Step 7: Hand off for experience testing**

Provide `apps/miniapp/dist`, the local commit IDs, test deployment evidence,
and the remaining owner-only WeChat Developer Tools upload/real-device checks.
Stop before merge or push.
