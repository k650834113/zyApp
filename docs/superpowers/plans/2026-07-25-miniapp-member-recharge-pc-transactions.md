# Miniapp Member Recharge and PC Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved member-only WeChat Mini Program, remove duplicate customer activity rows and canceled-payment cards, and add PC-wide consumption/recharge records plus a cashier-page manual cloud refresh.

**Architecture:** PostgreSQL remains the source of truth for member profiles, WeChat recharge orders, and immutable wallet entries. The Mini Program consumes a server-built business activity projection instead of merging accounting arrays itself; the desktop mirrors full recharge orders into SQLite and queries business documents separately from wallet ledger rows. Existing cloud sync and WeChat Pay settlement paths are reused rather than duplicated.

**Tech Stack:** Node.js 24, TypeScript 5.9, NestJS 11, PostgreSQL, Redis, Electron 42, React 19, SQLite, native WeChat Mini Program WXML/WXSS, Vitest 4, pnpm 10.12.1.

## Global Constraints

- Keep the production database disabled for this rollout; the Mini Program continues to use `https://judian.icu/test` and the isolated test PostgreSQL database.
- Use real WeChat login, phone authorization, HTTPS, API v3 payment, payment notification verification, and server-side settlement.
- Real-payment manual testing uses the configured 1-fen test tier and produces a real merchant transaction.
- Do not add member codes, QR codes, table opening, reservations, activities, staff, manager, or mobile cashier entry points to the current Mini Program build.
- The Mini Program bottom navigation is exactly `首页 / 明细 / 我的`; the only prominent home action is `立即充值`.
- Preserve every wallet ledger entry. De-duplication changes the business activity projection only.
- An explicit `wx.requestPayment` cancellation must not leave a pending card in the Mini Program.
- A non-cancellation payment error remains an unknown result and must query the original order instead of creating a replacement.
- The PC manual refresh must preserve the selected member, cart, quantities, note, payment method, and every unsubmitted cashier field.
- Avatar files accept JPEG, PNG, or WebP only, are limited to 2 MiB, use server-generated names, and are stored outside Git in separate production/test persistent volumes.
- Configure `https://judian.icu` as the WeChat `request`, `uploadFile`, and `downloadFile` legal domain; `socket`, UDP, TCP, and DNS pre-resolution remain empty.
- Never log or commit the AppSecret, APIv3 key, merchant private key, platform public key, authorization headers, OpenID, full phone number, or uploaded avatar bytes.
- Preserve `infra/deploy/production.env.before-domain-20260725`; it is a user backup and must not be staged.
- Approved visual reference: `docs/superpowers/specs/assets/2026-07-25-miniapp-member-recharge-visual-a.png`.

## File Structure

### Shared contracts and persistence

- Modify `packages/contracts/src/index.ts`: profile completion, unified activity, recharge transaction, IPC, and `DesktopApi` types.
- Create `packages/cloud-db/migrations/0017_member_profile_completion.sql`: persist whether the Mini Program profile has been completed.
- Modify `packages/cloud-db/src/schema.ts`: expose `profile_completed`.
- Modify `packages/local-db/src/migrations.ts`: add SQLite schema version 26 for mirrored WeChat recharge orders.
- Modify `packages/local-db/src/cloud-mirror-materialization.ts`: materialize full recharge orders.
- Create `packages/local-db/src/transaction-record.ts`: global consumption/recharge queries.
- Create `packages/local-db/src/transaction-record.test.ts`: query and de-duplication coverage.
- Modify `packages/local-db/src/index.ts`: export transaction record queries.

### API

- Modify `apps/api/src/member-self-service.ts`: validate profile updates.
- Modify `apps/api/src/member-self-service.service.ts`: protect completed profiles, update profile data, and build unified activities.
- Modify `apps/api/src/member-self-service.controller.ts`: expose JSON profile update.
- Create `apps/api/src/member-avatar.service.ts`: validate and atomically persist avatar files.
- Create `apps/api/src/member-avatar.service.test.ts`: avatar validation and cleanup tests.
- Create `apps/api/src/member-avatar.controller.ts`: multipart profile update and public avatar read.
- Create `apps/api/src/member-avatar.controller.test.ts`: authentication, upload, and response tests.
- Modify `apps/api/src/app.module.ts`: register avatar components.
- Modify `apps/api/src/config.ts` and `apps/api/src/config.test.ts`: avatar directory/public base URL configuration.
- Modify `apps/api/src/desktop-mirror.service.ts` and its tests: expose `wechat_recharge_orders`.

### Mini Program

- Modify `apps/miniapp/src/services/types.ts`, `http-client.ts`, and `mock-client.ts`: profile update/upload and unified history.
- Modify `apps/miniapp/src/services/member-login.ts` and its tests: nickname validation without deprecated silent profile acquisition.
- Create `apps/miniapp/src/services/recharge-flow.ts` and `recharge-flow.test.ts`: testable payment cancellation/unknown-result orchestration.
- Create `apps/miniapp/src/pages/history/index.ts`, `index.wxml`, `index.wxss`, and `index.json`: aligned business activity page.
- Modify `apps/miniapp/src/pages/home/index.ts`, `index.wxml`, `index.wxss`, and `index.json`: approved home design.
- Modify `apps/miniapp/src/pages/member/index.ts`, `index.wxml`, `index.wxss`, and `index.json`: first-time and later profile editing.
- Modify `apps/miniapp/src/app.json` and `app.wxss`: member-only routes and shared visual tokens.
- Modify `apps/miniapp/package.json`: include the new service tests.

### Desktop

- Modify `apps/merchant-desktop/src/main/index.ts`: mirror recharge orders and register transaction IPC handlers.
- Modify `apps/merchant-desktop/src/preload/index.ts`: expose transaction methods.
- Modify `apps/merchant-desktop/src/renderer/src/api.ts`: preview implementations for the new methods.
- Create `apps/merchant-desktop/src/renderer/src/TransactionsPage.tsx`: consumption/recharge tabs and read-only details.
- Create `apps/merchant-desktop/src/renderer/src/cashier-refresh.ts` and `cashier-refresh.test.ts`: preserve-safe manual refresh orchestration.
- Modify `apps/merchant-desktop/src/renderer/src/CashierPage.tsx`: top-right refresh button.
- Modify `apps/merchant-desktop/src/renderer/src/AppShell.tsx`: `交易记录` navigation.
- Modify `apps/merchant-desktop/src/renderer/src/styles.css`: transaction and refresh states.

### Deployment and documentation

- Modify `infra/deploy/compose.production.yml`: separate avatar volumes for `api` and `api-test`.
- Modify `infra/deploy/production.env.example`: avatar directory and public URL variables.
- Modify `infra/docker/compose.yml` and `infra/docker/cloud.env.example`: local equivalents.
- Modify `infra/deploy/README.md`: WeChat legal-domain and avatar-volume checks.
- Create `docs/0.23.0会员小程序与交易记录验收.md`: automated and manual results.

---

### Task 1: Persist and protect member profile completion

**Files:**
- Create: `packages/cloud-db/migrations/0017_member_profile_completion.sql`
- Modify: `packages/cloud-db/src/schema.ts`
- Modify: `packages/cloud-db/src/migrations.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/member-self-service.ts`
- Modify: `apps/api/src/member-self-service.test.ts`
- Modify: `apps/api/src/member-self-service.service.ts`
- Modify: `apps/api/src/member-self-service.service.test.ts`
- Modify: `apps/api/src/member-self-service.controller.ts`
- Modify: `apps/api/src/member-self-service.controller.test.ts`

**Interfaces:**
- Consumes: existing `MiniappPrincipal`, `MemberSelfServiceSummary`, and API idempotency storage.
- Produces:

```ts
export type UpdateMemberProfileRequest = {
  requestId: string
  nickname: string
}

export type MemberSelfServiceSummary = {
  // existing fields remain unchanged
  profileCompleted: boolean
}

MemberSelfService.updateProfile(
  principal: MiniappPrincipal,
  rawInput: unknown
): Promise<MemberSelfServiceSummary>
```

- [ ] **Step 1: Write the failing cloud migration test**

Add an assertion in `packages/cloud-db/src/migrations.test.ts` that migration `0017_member_profile_completion.sql` is discovered after `0016_member_wechat_profile.sql`, and that a migrated `cloud_member` row exposes `profile_completed`.

```ts
expect(migrationNames.at(-1)).toBe('0017_member_profile_completion.sql')
expect(columns).toContain('profile_completed')
```

- [ ] **Step 2: Run the migration test and verify it fails**

Run:

```powershell
pnpm vitest run packages/cloud-db/src/migrations.test.ts
```

Expected: FAIL because migration 0017 and `profile_completed` do not exist.

- [ ] **Step 3: Add the migration and Drizzle field**

Create `0017_member_profile_completion.sql`:

```sql
ALTER TABLE cloud_member
  ADD COLUMN profile_completed BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE cloud_member
SET profile_completed = TRUE
WHERE source <> 'miniapp' OR nickname <> '微信用户';
```

Add the exact field to the `cloudMember` schema:

```ts
profileCompleted: boolean('profile_completed').notNull().default(false),
```

- [ ] **Step 4: Write failing request validation and service tests**

Cover:

```ts
expect(validateUpdateMemberProfileRequest({
  requestId: 'profile-20260725-1',
  nickname: '  林小满  '
})).toEqual({
  requestId: 'profile-20260725-1',
  nickname: '林小满'
})

expect(() => validateUpdateMemberProfileRequest({
  requestId: 'profile-20260725-2',
  nickname: ' '
})).toThrow(/nickname/)
```

Service tests must prove:

- a new default `微信用户` member returns `profileCompleted: false`;
- a completed member logging in again without nickname/avatar keeps the saved name and avatar;
- `updateProfile` changes only the authenticated member, sets `profile_completed = TRUE`, emits `member.profile_updated`, and is idempotent by request ID;
- nickname length outside 2–12 visible characters is rejected.

- [ ] **Step 5: Run the profile tests and verify they fail**

Run:

```powershell
pnpm vitest run apps/api/src/member-self-service.test.ts apps/api/src/member-self-service.service.test.ts apps/api/src/member-self-service.controller.test.ts
```

Expected: FAIL because the request, summary field, endpoint, and profile-preservation rule are absent.

- [ ] **Step 6: Implement the profile contract, validator, service, and endpoint**

Add:

```ts
export function validateUpdateMemberProfileRequest(
  value: unknown
): UpdateMemberProfileRequest
```

Expose:

```ts
@Post('profile')
updateProfile(
  @Req() request: MiniappRequest,
  @Body() body: unknown
): Promise<MemberSelfServiceSummary> {
  return this.members.updateProfile(principal(request), body)
}
```

When one-tap login receives no real profile data, do not overwrite an existing completed profile with `微信用户` or `null`. Return `profile_completed` from every member summary query.

- [ ] **Step 7: Run focused tests and typechecks**

Run:

```powershell
pnpm vitest run packages/cloud-db/src/migrations.test.ts apps/api/src/member-self-service.test.ts apps/api/src/member-self-service.service.test.ts apps/api/src/member-self-service.controller.test.ts
pnpm --filter @zyapp/contracts typecheck
pnpm --filter @zyapp/cloud-db typecheck
pnpm --filter @zyapp/api typecheck
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```powershell
git add packages/contracts/src/index.ts packages/cloud-db/migrations/0017_member_profile_completion.sql packages/cloud-db/src/schema.ts packages/cloud-db/src/migrations.test.ts apps/api/src/member-self-service.ts apps/api/src/member-self-service.test.ts apps/api/src/member-self-service.service.ts apps/api/src/member-self-service.service.test.ts apps/api/src/member-self-service.controller.ts apps/api/src/member-self-service.controller.test.ts
git commit -m "feat: add member profile completion"
```

### Task 2: Add durable avatar upload and serving

**Files:**
- Create: `apps/api/src/member-avatar.service.ts`
- Create: `apps/api/src/member-avatar.service.test.ts`
- Create: `apps/api/src/member-avatar.controller.ts`
- Create: `apps/api/src/member-avatar.controller.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/member-self-service.service.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `infra/deploy/compose.production.yml`
- Modify: `infra/deploy/production.env.example`
- Modify: `infra/docker/compose.yml`
- Modify: `infra/docker/cloud.env.example`

**Interfaces:**
- Consumes: `MemberSelfService.updateProfileWithAvatar`, authenticated member ID, and the existing `avatar_url` column.
- Produces:

```ts
export type MemberAvatarUploadFile = {
  buffer: Buffer
  mimetype: 'image/jpeg' | 'image/png' | 'image/webp'
  size: number
}

MemberAvatarService.save(input: {
  memberId: string
  file: MemberAvatarUploadFile
}): Promise<{
  avatarUrl: string
  absolutePath: string
}>
```

HTTP routes:

```text
POST /v1/member/profile-with-avatar
GET  /v1/public/member-avatars/:fileName
```

- [ ] **Step 1: Write failing configuration and avatar service tests**

Test exact constraints:

```ts
expect(() => readApiConfig({
  ...baseEnvironment(),
  MEMBER_AVATAR_DIRECTORY: '',
  MINIAPP_PUBLIC_BASE_URL: ''
})).toThrow(/MEMBER_AVATAR_DIRECTORY/)
```

Avatar service tests use a temporary directory and verify:

- valid JPEG, PNG, and WebP signatures are accepted;
- a text file renamed `.png` is rejected;
- 2 MiB is accepted and 2 MiB + 1 byte is rejected;
- the client filename is never used;
- a failed profile database update removes the newly written file.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
pnpm vitest run apps/api/src/config.test.ts apps/api/src/member-avatar.service.test.ts apps/api/src/member-avatar.controller.test.ts
```

Expected: FAIL because avatar configuration and services are absent.

- [ ] **Step 3: Implement safe avatar persistence**

Add config fields:

```ts
memberAvatarDirectory: string
miniappPublicBaseUrl: string
```

Normalize `MINIAPP_PUBLIC_BASE_URL` without a trailing slash. Generate an opaque UUID filename, validate both MIME type and magic bytes, write to a temporary file in the configured directory, then rename atomically.

The public URL format is:

```ts
`${config.miniappPublicBaseUrl}/v1/public/member-avatars/${fileName}`
```

- [ ] **Step 4: Implement authenticated multipart profile update**

Use `FileInterceptor('avatar', { limits: { fileSize: 2 * 1024 * 1024 } })`. The multipart form contains `requestId` and `nickname`; the authenticated member ID always comes from `MiniappAuthGuard`.

The application flow is:

```ts
const saved = await avatars.save({ memberId, file })
try {
  return await members.updateProfileWithAvatar(principal, {
    requestId,
    nickname,
    avatarUrl: saved.avatarUrl
  })
} catch (error) {
  await avatars.remove(saved.absolutePath)
  throw error
}
```

Serve only filenames matching the server-generated UUID plus approved extension. Set `Content-Type`, `Cache-Control: public, max-age=31536000, immutable`, and `X-Content-Type-Options: nosniff`.

- [ ] **Step 5: Add separate production and test volumes**

Set:

```yaml
MEMBER_AVATAR_DIRECTORY: /app/data/member-avatars
MINIAPP_PUBLIC_BASE_URL: https://judian.icu
```

for `api`, and:

```yaml
MEMBER_AVATAR_DIRECTORY: /app/data/member-avatars
MINIAPP_PUBLIC_BASE_URL: https://judian.icu/test
```

for `api-test`.

Mount distinct named volumes:

```yaml
avatar-production-data:
avatar-test-data:
```

Do not mount either volume into the other API container.

- [ ] **Step 6: Run focused tests, API build, and compose validation**

Run:

```powershell
pnpm vitest run apps/api/src/config.test.ts apps/api/src/member-avatar.service.test.ts apps/api/src/member-avatar.controller.test.ts
pnpm --filter @zyapp/api typecheck
pnpm --filter @zyapp/api build
docker compose --env-file infra/deploy/production.env.example -f infra/deploy/compose.production.yml config
```

Expected: tests and builds PASS; compose renders two separate avatar volumes. If Docker is unavailable, record the exact unavailable-engine error and run the repository's static deployment checks in Task 11.

- [ ] **Step 7: Commit**

```powershell
git add packages/contracts/src/index.ts apps/api/src/member-avatar.service.ts apps/api/src/member-avatar.service.test.ts apps/api/src/member-avatar.controller.ts apps/api/src/member-avatar.controller.test.ts apps/api/src/app.module.ts apps/api/src/config.ts apps/api/src/config.test.ts apps/api/src/member-self-service.service.ts infra/deploy/compose.production.yml infra/deploy/production.env.example infra/docker/compose.yml infra/docker/cloud.env.example
git commit -m "feat: add durable member avatars"
```

### Task 3: Build the unified member business activity projection

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/member-self-service.service.ts`
- Modify: `apps/api/src/member-self-service.service.test.ts`
- Modify: `apps/miniapp/src/services/mock-client.ts`
- Modify: `apps/miniapp/src/services/mock-client.test.ts`

**Interfaces:**
- Consumes: `cloud_sales_order`, settled `wechat_recharge_order`, and `cloud_monthly_card_event`.
- Produces:

```ts
export type MemberActivitySummary = {
  activityId: string
  kind: 'consumption' | 'recharge' | 'monthly_card'
  businessId: string
  businessNumber: string | null
  title: string
  amountFen: number | null
  direction: 'debit' | 'credit' | 'neutral'
  status:
    | 'completed'
    | 'settled'
    | 'active'
    | 'paused'
    | 'resumed'
    | 'used'
    | 'refunded'
    | 'expired'
  occurredAt: string
}

export type MemberSelfServiceHistory = {
  activities: MemberActivitySummary[]
  orders: MemberOrderHistoryItem[]
  walletEntries: MemberWalletHistoryItem[]
  monthlyCardEvents: MemberMonthlyCardHistoryItem[]
}
```

- [ ] **Step 1: Write the failing history projection test**

Create fixtures with:

- one stored-value sales order for 6,800 fen;
- its `wallet.debited` ledger row with reason `订单 XS001 储值支付`;
- one settled 10,000-fen WeChat recharge;
- one monthly-card purchase.

Assert:

```ts
expect(history.activities.map((item) => item.title)).toEqual([
  '桌位消费',
  '微信充值',
  '月卡续费'
])
expect(history.activities.filter((item) => item.kind === 'consumption')).toHaveLength(1)
expect(history.walletEntries).toHaveLength(1)
```

This proves the ledger remains available while the customer-facing activity is not duplicated.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
pnpm vitest run apps/api/src/member-self-service.service.test.ts
```

Expected: FAIL because `activities` is absent.

- [ ] **Step 3: Implement server-built activities**

Query consumption orders, settled WeChat recharge orders, and monthly-card events. Map them independently, concatenate, sort by `occurredAt` descending with `activityId` as a stable tie-breaker, and cap the response at 100 activities.

Do not derive consumption activities from wallet reasons. Do not include `creating`, `pending_payment`, `failed`, or `expired` recharge orders in member activities.

- [ ] **Step 4: Update mock data and contract consumers**

Add deterministic `activities` to `MockMiniappClient.getMemberHistory()`. Preserve raw arrays temporarily for compatibility and accounting diagnostics; new Mini Program pages must consume `activities`.

- [ ] **Step 5: Run focused tests and typechecks**

Run:

```powershell
pnpm vitest run apps/api/src/member-self-service.service.test.ts apps/miniapp/src/services/mock-client.test.ts
pnpm --filter @zyapp/contracts typecheck
pnpm --filter @zyapp/api typecheck
pnpm --filter @zyapp/miniapp typecheck
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/contracts/src/index.ts apps/api/src/member-self-service.service.ts apps/api/src/member-self-service.service.test.ts apps/miniapp/src/services/mock-client.ts apps/miniapp/src/services/mock-client.test.ts
git commit -m "feat: add unified member activities"
```

### Task 4: Add Mini Program profile client services

**Files:**
- Modify: `apps/miniapp/src/services/types.ts`
- Modify: `apps/miniapp/src/services/http-client.ts`
- Modify: `apps/miniapp/src/services/http-client.test.ts`
- Modify: `apps/miniapp/src/services/mock-client.ts`
- Modify: `apps/miniapp/src/services/member-login.ts`
- Modify: `apps/miniapp/src/services/member-login.test.ts`
- Modify: `apps/miniapp/package.json`

**Interfaces:**
- Consumes: Task 1 JSON profile endpoint and Task 2 multipart endpoint.
- Produces:

```ts
MiniappClient.updateMemberProfile(
  nickname: string
): Promise<MemberSelfServiceSummary>

MiniappClient.updateMemberProfileWithAvatar(
  nickname: string,
  localAvatarPath: string
): Promise<MemberSelfServiceSummary>

export function normalizeMemberNickname(value: string): string
```

- [ ] **Step 1: Write failing nickname and upload-client tests**

Assert:

```ts
expect(normalizeMemberNickname('  林小满  ')).toBe('林小满')
expect(() => normalizeMemberNickname('A')).toThrow(/2 至 12/)
expect(() => normalizeMemberNickname('1234567890123')).toThrow(/2 至 12/)
```

Mock `wx.uploadFile` and assert the request contains:

```ts
{
  url: 'https://judian.icu/test/v1/member/profile-with-avatar',
  filePath: 'wxfile://avatar',
  name: 'avatar',
  header: { Authorization: 'Bearer member-token' },
  formData: {
    requestId: expect.stringMatching(/^profile-/),
    nickname: '林小满'
  }
}
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
pnpm vitest run apps/miniapp/src/services/member-login.test.ts apps/miniapp/src/services/http-client.test.ts
```

Expected: FAIL because profile update/upload methods and strict nickname validation are absent.

- [ ] **Step 3: Implement JSON and multipart client paths**

Generate one request ID per save attempt. Reuse `ensureSession()` before `wx.uploadFile`. Parse non-2xx upload responses using the same readable server-message rules as `wx.request`.

On a 401 upload response, clear the token, create one new session, and retry the same request ID once.

- [ ] **Step 4: Remove deprecated silent profile acquisition**

Stop using `wx.getUserProfile` in the member login flow. The phone login request sends no fake nickname or temporary `wxfile://` avatar. The profile page uses:

```xml
<button open-type="chooseAvatar" bindchooseavatar="chooseAvatar">选择头像</button>
<input type="nickname" value="{{nickname}}" bindinput="inputNickname" />
```

The input allows WeChat's nickname suggestion or custom text, but saving remains an explicit user action.

- [ ] **Step 5: Add new tests to the Mini Program test script**

Ensure `apps/miniapp/package.json` runs every newly created Mini Program service test, including `recharge-flow.test.ts` from Task 5.

- [ ] **Step 6: Run service tests and Mini Program typecheck**

Run:

```powershell
pnpm --filter @zyapp/miniapp test
pnpm --filter @zyapp/miniapp typecheck
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/miniapp/src/services/types.ts apps/miniapp/src/services/http-client.ts apps/miniapp/src/services/http-client.test.ts apps/miniapp/src/services/mock-client.ts apps/miniapp/src/services/member-login.ts apps/miniapp/src/services/member-login.test.ts apps/miniapp/package.json
git commit -m "feat: add miniapp profile client"
```

### Task 5: Make recharge cancellation and unknown results explicit

**Files:**
- Create: `apps/miniapp/src/services/recharge-flow.ts`
- Create: `apps/miniapp/src/services/recharge-flow.test.ts`
- Modify: `apps/miniapp/src/services/wechat-payment.ts`
- Modify: `apps/miniapp/src/services/wechat-payment.test.ts`

**Interfaces:**
- Consumes: existing order creation, `requestWechatPayment`, and `pollRechargeOrder`.
- Produces:

```ts
export type RechargeFlowResult =
  | { kind: 'cancelled' }
  | { kind: 'confirmed'; order: MemberRechargeOrderSummary }
  | { kind: 'pending'; order: MemberRechargeOrderSummary }

export async function runRechargeFlow(input: {
  createOrder(): Promise<MemberRechargeOrderSummary>
  requestPayment(
    parameters: WechatJsapiPaymentParameters
  ): Promise<'completed' | 'cancelled'>
  getOrder(orderId: string): Promise<MemberRechargeOrderSummary>
}): Promise<RechargeFlowResult>
```

- [ ] **Step 1: Write the failing cancellation and unknown-result tests**

Test:

```ts
expect(await runRechargeFlow(cancelInput)).toEqual({ kind: 'cancelled' })
expect(cancelInput.getOrder).not.toHaveBeenCalled()
```

For a non-cancellation `requestPayment` rejection, assert that the original order ID is polled and no second create call occurs.

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
pnpm vitest run apps/miniapp/src/services/wechat-payment.test.ts apps/miniapp/src/services/recharge-flow.test.ts
```

Expected: FAIL because `runRechargeFlow` does not exist.

- [ ] **Step 3: Implement the orchestration**

Rules:

```ts
if (paymentResult === 'cancelled') return { kind: 'cancelled' }
const order = await pollRechargeOrder({ orderId, getOrder })
return order.status === 'settled'
  ? { kind: 'confirmed', order }
  : { kind: 'pending', order }
```

Catch only non-cancellation payment errors around `requestPayment`, then poll the original order. Parameter parsing and cryptographic trust remain server-controlled.

- [ ] **Step 4: Run the tests**

Run:

```powershell
pnpm vitest run apps/miniapp/src/services/wechat-payment.test.ts apps/miniapp/src/services/recharge-flow.test.ts
pnpm --filter @zyapp/miniapp typecheck
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/miniapp/src/services/recharge-flow.ts apps/miniapp/src/services/recharge-flow.test.ts apps/miniapp/src/services/wechat-payment.ts apps/miniapp/src/services/wechat-payment.test.ts
git commit -m "fix: hide cancelled recharge orders"
```

### Task 6: Implement the approved member-only Mini Program UI

**Files:**
- Modify: `apps/miniapp/src/app.json`
- Modify: `apps/miniapp/src/app.wxss`
- Modify: `apps/miniapp/src/pages/home/index.ts`
- Modify: `apps/miniapp/src/pages/home/index.wxml`
- Modify: `apps/miniapp/src/pages/home/index.wxss`
- Modify: `apps/miniapp/src/pages/home/index.json`
- Modify: `apps/miniapp/src/pages/member/index.ts`
- Modify: `apps/miniapp/src/pages/member/index.wxml`
- Modify: `apps/miniapp/src/pages/member/index.wxss`
- Modify: `apps/miniapp/src/pages/member/index.json`
- Create: `apps/miniapp/src/pages/history/index.ts`
- Create: `apps/miniapp/src/pages/history/index.wxml`
- Create: `apps/miniapp/src/pages/history/index.wxss`
- Create: `apps/miniapp/src/pages/history/index.json`
- Modify: `apps/miniapp/scripts/build-configuration.test.mjs`

**Interfaces:**
- Consumes: `MemberSelfServiceSummary.profileCompleted`, Task 3 `activities`, Task 4 profile client, and Task 5 recharge flow.
- Produces: the three approved customer pages and no customer-visible future-function entry.

- [ ] **Step 1: Write the failing build-scope test**

Read `src/app.json` and assert:

```js
assert.deepEqual(app.pages, [
  'pages/home/index',
  'pages/history/index',
  'pages/member/index'
])
assert.equal(JSON.stringify(app).includes('staff'), false)
assert.equal(JSON.stringify(app).includes('manager'), false)
assert.equal(JSON.stringify(app).includes('activities'), false)
```

- [ ] **Step 2: Run the build configuration test and verify it fails**

Run:

```powershell
node --test apps/miniapp/scripts/build-configuration.test.mjs
```

Expected: FAIL because current routes include activities, staff, manager, and content.

- [ ] **Step 3: Rebuild the home page**

Implement:

- profile header with avatar, nickname, member tier, and edit action;
- one balance card with total stored value and monthly-card state;
- one full-width `立即充值` action;
- recent activities rendered from `history.activities.slice(0, 3)`;
- `全部明细` navigation to `/pages/history/index`;
- bottom navigation `首页 / 明细 / 我的`.

Remove the store status strip, member code, QR icon, table-opening action, activity link, and employee/manager switches.

- [ ] **Step 4: Implement first-time and later profile editing**

If `profileCompleted === false`, redirect to `/pages/member/index?mode=complete` after phone login. The page blocks leaving through its save button until a valid nickname has been stored, while avatar remains optional.

For an existing profile, use the same page with `mode=edit`. Submit JSON when no new local avatar is selected and multipart when a new avatar is selected.

- [ ] **Step 5: Implement the aligned history page**

Use filters:

```ts
type HistoryFilter = 'all' | 'consumption' | 'recharge' | 'monthly_card'
```

Group `MemberActivitySummary` by local calendar date. Every row renders one business event with left-aligned title/time/order number and right-aligned amount/status. Do not render raw `walletEntries`.

- [ ] **Step 6: Connect the cancellation result**

On:

```ts
{ kind: 'cancelled' }
```

set `rechargeOrder` to `null`, close the result card, and show `已取消支付`.

On `confirmed`, refresh summary and history. On `pending`, show `正在确认支付结果` and keep the original order ID for retry.

- [ ] **Step 7: Apply visual tokens and responsive checks**

Use:

```css
--member-green: #174f3b;
--member-green-deep: #103e30;
--member-cream: #fbf7ef;
--member-card: #fffdf8;
--member-gold: #c87917;
--member-border: #e8dece;
```

Ensure the 320px and 375px simulator widths do not overflow, amount columns remain aligned, and touch targets are at least 44 CSS pixels.

- [ ] **Step 8: Run Mini Program tests and build**

Run:

```powershell
pnpm --filter @zyapp/miniapp test
pnpm --filter @zyapp/miniapp typecheck
pnpm --filter @zyapp/miniapp build
```

Expected: all PASS and `dist/app.json` contains only the three member routes.

- [ ] **Step 9: Commit**

```powershell
git add apps/miniapp/src/app.json apps/miniapp/src/app.wxss apps/miniapp/src/pages/home apps/miniapp/src/pages/member apps/miniapp/src/pages/history apps/miniapp/scripts/build-configuration.test.mjs
git commit -m "feat: redesign member-only miniapp"
```

### Task 7: Mirror full WeChat recharge orders to SQLite

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/desktop-mirror.service.ts`
- Modify: `apps/api/src/desktop-mirror.service.test.ts`
- Modify: `packages/local-db/src/migrations.ts`
- Modify: `packages/local-db/src/local-db.test.ts`
- Modify: `packages/local-db/src/cloud-mirror-materialization.ts`
- Modify: `packages/local-db/src/cloud-mirror-materialization.test.ts`
- Modify: `apps/merchant-desktop/src/main/index.ts`

**Interfaces:**
- Consumes: PostgreSQL `wechat_recharge_order`.
- Produces: `CloudMirrorResource` value `wechat_recharge_orders` and SQLite table `wechat_recharge_order_mirror`.

- [ ] **Step 1: Write failing mirror-resource tests**

API test:

```ts
await service.page(principal, 'wechat_recharge_orders', undefined, '200')
expect(query).toHaveBeenCalledWith(
  expect.stringContaining('wechat_recharge_order'),
  expect.any(Array)
)
```

Local materialization test asserts a settled and a pending order are both stored with provider transaction IDs and status intact.

- [ ] **Step 2: Write the failing SQLite migration test**

Assert:

```ts
expect(local.schemaVersion).toBe(26)
expect(columns).toEqual(expect.arrayContaining([
  'id',
  'out_trade_no',
  'provider_transaction_id',
  'principal_fen',
  'gift_fen',
  'status',
  'created_at',
  'settled_at'
]))
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```powershell
pnpm vitest run apps/api/src/desktop-mirror.service.test.ts packages/local-db/src/local-db.test.ts packages/local-db/src/cloud-mirror-materialization.test.ts
```

Expected: FAIL because the resource and local table are absent.

- [ ] **Step 4: Add resource, table, and materializer**

Add:

```ts
| 'wechat_recharge_orders'
```

to `CloudMirrorResource`, map it to `wechat_recharge_order`, mark it tenant-wide, and add it after `wallet_ledger` in `CLOUD_MIRROR_REFRESH_ORDER`.

SQLite version 26 stores every field needed by the PC list. `applyCloudMirrorPage` upserts by order ID and never creates a wallet ledger entry from the order row.

- [ ] **Step 5: Run focused tests and typechecks**

Run:

```powershell
pnpm vitest run apps/api/src/desktop-mirror.service.test.ts packages/local-db/src/local-db.test.ts packages/local-db/src/cloud-mirror-materialization.test.ts
pnpm --filter @zyapp/contracts typecheck
pnpm --filter @zyapp/local-db typecheck
pnpm --filter @zyapp/merchant-desktop typecheck
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/contracts/src/index.ts apps/api/src/desktop-mirror.service.ts apps/api/src/desktop-mirror.service.test.ts packages/local-db/src/migrations.ts packages/local-db/src/local-db.test.ts packages/local-db/src/cloud-mirror-materialization.ts packages/local-db/src/cloud-mirror-materialization.test.ts apps/merchant-desktop/src/main/index.ts
git commit -m "feat: mirror wechat recharge orders"
```

### Task 8: Add PC transaction queries and IPC

**Files:**
- Create: `packages/local-db/src/transaction-record.ts`
- Create: `packages/local-db/src/transaction-record.test.ts`
- Modify: `packages/local-db/src/index.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/merchant-desktop/src/main/index.ts`
- Modify: `apps/merchant-desktop/src/preload/index.ts`
- Modify: `apps/merchant-desktop/src/renderer/src/api.ts`

**Interfaces:**
- Consumes: `sales_order`, `sales_order_item`, `wallet_recharge`, `wechat_recharge_order_mirror`, and `member`.
- Produces:

```ts
export type ListTransactionRecordsRequest = {
  query?: string
  from?: string
  to?: string
  limit?: number
}

export type RechargeTransactionSummary = {
  id: string
  orderNumber: string
  memberId: string
  memberNickname: string
  phoneMasked: string
  channel: 'cash' | 'wechat'
  principalFen: number
  giftFen: number
  totalCreditFen: number
  status: 'pending_payment' | 'settled' | 'failed' | 'expired'
  providerTransactionId: string | null
  createdAt: string
  settledAt: string | null
}

DesktopApi.listSalesTransactions(
  request: ListTransactionRecordsRequest
): Promise<SalesOrderSummary[]>

DesktopApi.listRechargeTransactions(
  request: ListTransactionRecordsRequest
): Promise<RechargeTransactionSummary[]>
```

- [ ] **Step 1: Write failing local query tests**

Seed:

- one cash sales order;
- one stored-value sales order;
- one cash wallet recharge;
- one settled mirrored WeChat recharge;
- one pending mirrored WeChat recharge.

Assert:

```ts
expect(listSalesTransactions(db, context, { query: member.nickname }))
  .toHaveLength(1)
expect(listRechargeTransactions(db, context, {}))
  .toEqual(expect.arrayContaining([
    expect.objectContaining({ channel: 'cash', status: 'settled' }),
    expect.objectContaining({ channel: 'wechat', status: 'settled' }),
    expect.objectContaining({ channel: 'wechat', status: 'pending_payment' })
  ]))
```

Also assert the settled WeChat recharge appears once even though its wallet ledger projection created a `wallet_recharge` row.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
pnpm vitest run packages/local-db/src/transaction-record.test.ts
```

Expected: FAIL because transaction query functions are absent.

- [ ] **Step 3: Implement validated global queries**

Normalize `limit` to 1–200. Parse `from` and `to` as ISO date boundaries. Search order number, recharge number, nickname, member number, and phone suffix.

Cash recharge rows come from `wallet_recharge WHERE payment_method = 'cash'`. WeChat rows come only from `wechat_recharge_order_mirror`; do not union `wallet_recharge.payment_method = 'wechat'`.

- [ ] **Step 4: Add IPC and desktop bridge methods**

Add channels:

```ts
transactionSalesList: 'transaction:sales:list',
transactionRechargeList: 'transaction:recharge:list',
```

Before a sales read, refresh `orders` and `order_items`. Before a recharge read, refresh `wechat_recharge_orders`, `members`, and `wallet_ledger`. Then query SQLite.

- [ ] **Step 5: Run focused tests and desktop typecheck**

Run:

```powershell
pnpm vitest run packages/local-db/src/transaction-record.test.ts
pnpm --filter @zyapp/contracts typecheck
pnpm --filter @zyapp/local-db typecheck
pnpm --filter @zyapp/merchant-desktop typecheck
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/local-db/src/transaction-record.ts packages/local-db/src/transaction-record.test.ts packages/local-db/src/index.ts packages/contracts/src/index.ts apps/merchant-desktop/src/main/index.ts apps/merchant-desktop/src/preload/index.ts apps/merchant-desktop/src/renderer/src/api.ts
git commit -m "feat: add desktop transaction queries"
```

### Task 9: Build the PC transaction records page

**Files:**
- Create: `apps/merchant-desktop/src/renderer/src/TransactionsPage.tsx`
- Modify: `apps/merchant-desktop/src/renderer/src/AppShell.tsx`
- Modify: `apps/merchant-desktop/src/renderer/src/styles.css`

**Interfaces:**
- Consumes: Task 8 desktop bridge methods.
- Produces: top-level `交易记录` navigation with `消费单 / 充值单` tabs and read-only details.

- [ ] **Step 1: Implement the page state and fetch boundaries**

Use:

```ts
type TransactionTab = 'sales' | 'recharges'
```

Maintain query, start date, end date, loading, error, selected row, and per-tab result arrays. Switching tabs does not discard the other tab's filters or cached result.

- [ ] **Step 2: Implement consumption rows and details**

Render order number, completion time, member, total, payment method, and status. Selecting a row displays item name, quantity, applied unit price, line total, note, and stored-value/cash payment composition.

- [ ] **Step 3: Implement recharge rows and details**

Render recharge number, member, principal, gift, total credit, channel, status, and time. Details include merchant order number, provider transaction ID when present, created time, settled time, and status.

Use distinct labels:

```ts
const rechargeStatusLabel = {
  pending_payment: '待支付',
  settled: '已到账',
  failed: '失败',
  expired: '已过期'
}
```

Only `settled` rows use the positive到账 emphasis. Pending, failed, and expired rows never contribute to an到账 total.

- [ ] **Step 4: Add AppShell navigation and permissions**

Add `transactions` to `Page`. Show `交易记录` when the session can use cashier, wallet, or reports:

```ts
const canReadTransactions = canUseCashier || canUseWallet || canReadReports
```

Do not remove or repurpose the existing `储值账户` page.

- [ ] **Step 5: Add layout and responsive styling**

Use the existing panel, table, button, badge, and page-header conventions. Keep filter controls visible at 1280×720 and allow table body scrolling without moving the AppShell footer.

- [ ] **Step 6: Run desktop typecheck and build**

Run:

```powershell
pnpm --filter @zyapp/merchant-desktop typecheck
pnpm --filter @zyapp/merchant-desktop build
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/merchant-desktop/src/renderer/src/TransactionsPage.tsx apps/merchant-desktop/src/renderer/src/AppShell.tsx apps/merchant-desktop/src/renderer/src/styles.css
git commit -m "feat: add desktop transaction records"
```

### Task 10: Add preserve-safe cashier manual refresh

**Files:**
- Create: `apps/merchant-desktop/src/renderer/src/cashier-refresh.ts`
- Create: `apps/merchant-desktop/src/renderer/src/cashier-refresh.test.ts`
- Modify: `apps/merchant-desktop/src/renderer/src/CashierPage.tsx`
- Modify: `apps/merchant-desktop/src/renderer/src/styles.css`

**Interfaces:**
- Consumes: existing `DesktopApi.syncCloudNow`, cashier data reads, and current selected member ID.
- Produces:

```ts
export async function refreshCashierCloudData(
  api: Pick<
    DesktopApi,
    | 'syncCloudNow'
    | 'listCatalogItems'
    | 'listRecentOrders'
    | 'listCashierMembers'
    | 'getWalletDetails'
    | 'getMonthlyCardDetails'
  >,
  selectedMemberId: string | null
): Promise<{
  cloud: CloudConnectionStatus
  catalog: CatalogItemSummary[]
  orders: SalesOrderSummary[]
  members: CashierMemberOption[]
  selectedMember: CashierMemberOption | null
  wallet: WalletDetails | null
  monthlyCard: MonthlyCardDetails | null
}>
```

- [ ] **Step 1: Write the failing refresh orchestration tests**

Test that:

```ts
expect(api.syncCloudNow).toHaveBeenCalledOnce()
expect(api.listCashierMembers).toHaveBeenCalledOnce()
expect(result.selectedMember?.id).toBe('member-1')
expect(result.wallet?.wallet.totalBalanceFen).toBe(10001)
```

Assert member-specific reads are skipped when `selectedMemberId` is null. Assert a sync rejection stops subsequent refresh reads and propagates the readable error.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
pnpm vitest run apps/merchant-desktop/src/renderer/src/cashier-refresh.test.ts
```

Expected: FAIL because the orchestration helper is absent.

- [ ] **Step 3: Implement refresh orchestration**

Call `syncCloudNow()` first. After it resolves, load catalog, recent orders, and members in parallel. Find the selected member by ID, then load that member's wallet and monthly card in parallel.

The helper returns data only; it must not own React cart state.

- [ ] **Step 4: Add the top-right button without reusing full-page loading**

Add `syncing` state separate from initial `loading` and order-submission `busy`.

Header action:

```tsx
<button
  className="secondary-button cashier-refresh-button"
  type="button"
  disabled={syncing}
  onClick={() => void manualRefresh()}
>
  {syncing ? '同步中…' : '刷新'}
</button>
```

`manualRefresh()` updates only catalog, orders, members, selected member, wallet, and monthly card. It must not call setters for cart, note, quantities, payment method, custom charge fields, or member action form fields.

Success text uses `cloud.lastSuccessAt` and reports `pendingOperations` when nonzero.

- [ ] **Step 5: Run focused tests, typecheck, and build**

Run:

```powershell
pnpm vitest run apps/merchant-desktop/src/renderer/src/cashier-refresh.test.ts
pnpm --filter @zyapp/merchant-desktop typecheck
pnpm --filter @zyapp/merchant-desktop build
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/merchant-desktop/src/renderer/src/cashier-refresh.ts apps/merchant-desktop/src/renderer/src/cashier-refresh.test.ts apps/merchant-desktop/src/renderer/src/CashierPage.tsx apps/merchant-desktop/src/renderer/src/styles.css
git commit -m "feat: add cashier cloud refresh"
```

### Task 11: Validate deployment, legal domains, and the complete release

**Files:**
- Modify: `infra/deploy/README.md`
- Create: `docs/0.23.0会员小程序与交易记录验收.md`
- Modify: `package.json`
- Modify: `apps/merchant-desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/merchant-desktop/release-notes.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: version `0.23.0`, reproducible verification evidence, and a user-run real-payment checklist.

- [ ] **Step 1: Document the required WeChat domain change**

Add the exact admin-console values:

```text
request 合法域名：https://judian.icu
uploadFile 合法域名：https://judian.icu
downloadFile 合法域名：https://judian.icu
socket 合法域名：留空
```

Document that the user must save the domain configuration, wait for propagation, compile with legal-domain checking enabled, and test avatar upload/download on a physical phone.

- [ ] **Step 2: Run focused automated tests**

Run:

```powershell
pnpm vitest run apps/api/src/member-self-service.test.ts apps/api/src/member-self-service.service.test.ts apps/api/src/member-avatar.service.test.ts apps/api/src/member-avatar.controller.test.ts apps/api/src/desktop-mirror.service.test.ts packages/cloud-db/src/migrations.test.ts packages/local-db/src/local-db.test.ts packages/local-db/src/cloud-mirror-materialization.test.ts packages/local-db/src/transaction-record.test.ts apps/miniapp/src/services/member-login.test.ts apps/miniapp/src/services/http-client.test.ts apps/miniapp/src/services/wechat-payment.test.ts apps/miniapp/src/services/recharge-flow.test.ts apps/merchant-desktop/src/renderer/src/cashier-refresh.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run full repository verification**

Run:

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @zyapp/miniapp build
git diff --check
```

Expected: all PASS and no whitespace errors.

- [ ] **Step 4: Validate production-test configuration without secrets**

Run the repository deployment/configuration checks that do not print secret values:

```powershell
node --test apps/miniapp/scripts/build-configuration.test.mjs
pnpm vitest run apps/api/src/config.test.ts
curl.exe --fail --silent --show-error https://124.220.69.209/v1/health/ready
curl.exe --fail --silent --show-error https://124.220.69.209/test/v1/health/ready
curl.exe --fail --silent --show-error https://judian.icu/v1/health/ready
curl.exe --fail --silent --show-error https://judian.icu/test/v1/health/ready
```

Expected: the build/configuration tests pass and all four production/test health addresses return a successful response without disabling TLS validation.

- [ ] **Step 5: Bump version and write release notes**

Set the root and desktop package versions to `0.23.0`, update the lockfile through pnpm, and add release notes covering:

- member profile and avatar editing;
- member-only Mini Program UI;
- canceled-payment display fix;
- unified activity de-duplication;
- PC transaction records;
- cashier manual refresh.

- [ ] **Step 6: Write automated evidence**

Record command, exit code, date/time, and concise result in `docs/0.23.0会员小程序与交易记录验收.md`. Do not paste secrets, full environment files, full phone numbers, or payment signatures.

- [ ] **Step 7: Commit the verified release state**

```powershell
git add infra/deploy/README.md docs/0.23.0会员小程序与交易记录验收.md package.json apps/merchant-desktop/package.json pnpm-lock.yaml apps/merchant-desktop/release-notes.md
git commit -m "chore: prepare 0.23.0 validation"
```

- [ ] **Step 8: Complete user-assisted physical-device acceptance**

The user performs:

1. save `request`, `uploadFile`, and `downloadFile` legal domains;
2. compile with the production AppID and legal-domain validation enabled;
3. register a new member and save a suggested WeChat nickname;
4. upload an avatar and confirm it survives re-entry;
5. edit nickname and avatar;
6. cancel a 0.01-yuan payment and confirm no pending card remains;
7. complete a 0.01-yuan payment and confirm one balance increase;
8. verify one stored-value consumption displays one Mini Program activity;
9. open PC `交易记录` and inspect the consumption and recharge documents;
10. complete another mobile recharge, click cashier `刷新`, and confirm the selected member balance updates without losing cart state.

- [ ] **Step 9: Record manual results and commit only non-sensitive evidence**

Append pass/fail results, device model, WeChat version, Mini Program build timestamp, merchant transaction number suffix, and screenshots with phone numbers masked. Commit the updated acceptance document:

```powershell
git add docs/0.23.0会员小程序与交易记录验收.md
git commit -m "docs: record 0.23.0 acceptance"
```
