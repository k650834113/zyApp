# Miniapp Production Test and WeChat Pay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a customer-only WeChat Mini Program build that uses the isolated test database with real WeChat login, real phone authorization, and one-cent WeChat Pay JSAPI recharge while preserving the PC IP endpoint.

**Architecture:** Add an explicit production-test miniapp build, a Node-native WeChat Pay API v3 adapter, and a public verified payment-notification boundary feeding the existing transactional recharge ledger. Deploy only the test API with read-only payment secrets and expose both the current IP certificate and `judian.icu` through Caddy.

**Tech Stack:** TypeScript 5.9, Node.js 24, NestJS 11, PostgreSQL 17, Vitest 4, native WeChat Mini Program APIs, Docker Compose, Caddy 2, PowerShell deployment scripts.

## Global Constraints

- All money values are safe integer fen; the live test amount is exactly `1` fen.
- The test API uses `DEPLOYMENT_ENVIRONMENT=test`, `zyapp_test`, real WeChat authentication, and real WeChat payment.
- The production API keeps `WECHAT_PAYMENT_MODE=disabled`.
- `https://124.220.69.209` remains the PC endpoint; the miniapp uses exactly `https://judian.icu/test`.
- Never trust `wx.requestPayment` success for wallet credit; only a verified notification or signed active-query result may settle.
- Wallet, payment, membership, audit, and sync records remain append-only and settle in one PostgreSQL transaction.
- Every financial command and callback is idempotent.
- The one-cent tier credits `1` principal fen, `0` gift fen, and no advanced membership source.
- No AppSecret, APIv3 key, merchant private key, database credential, or reusable session secret may enter Git, logs, screenshots, Docker images, or the miniapp package.
- Do not read or use `E:\证书\微信支付公钥ID.txt`; its former secret content makes it unsuitable as a deployment source.
- Employee, manager, content-management, refund, and formal-database payment flows remain out of scope.
- Keep the miniapp native TypeScript + WXML + WXSS.

---

## File Structure

New files:

- `apps/api/src/secret-file.ts`: validates and reads a one-line secret without logging it.
- `apps/api/src/secret-file.test.ts`: secret-file validation tests.
- `apps/api/src/wechatpay-crypto.ts`: API v3 canonical signing, signature verification, JSAPI signing, and AES-GCM notification decryption.
- `apps/api/src/wechatpay-crypto.test.ts`: generated-key cryptographic tests.
- `apps/api/src/wechatpay-provider.ts`: signed JSAPI create/query/close client and notification parser.
- `apps/api/src/wechatpay-provider.test.ts`: deterministic HTTP and signed-response tests.
- `apps/api/src/wechat-payment.controller.ts`: unauthenticated but cryptographically verified WeChat notification route.
- `apps/api/src/wechat-payment.controller.test.ts`: raw-body and response-contract tests.
- `apps/miniapp/src/services/wechat-payment.ts`: validated `wx.requestPayment` wrapper and bounded order polling.
- `apps/miniapp/src/services/wechat-payment.test.ts`: request-payment and polling tests.
- `infra/deploy/Caddyfile.dual-https`: simultaneous IP and domain TLS routing.
- `infra/scripts/deploy-miniapp-production-test.ps1`: isolated source, secret, test API, and Caddy deployment.

Focused modifications:

- `apps/api/src/config.ts`, `apps/api/src/config.test.ts`: real-payment configuration and environment gates.
- `apps/api/src/wechat-payment-provider.ts`: provider interface and Mock/disabled implementations.
- `apps/api/src/infrastructure.module.ts`: select the real provider only for `WECHAT_PAYMENT_MODE=wechat`.
- `apps/api/src/member-recharge.service.ts`, `apps/api/src/member-recharge.service.test.ts`: test tier, verified settlement, active query, and safe expiry.
- `apps/api/src/member-self-service.controller.ts`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`: configuration endpoint, notification controller, and raw request body.
- `packages/contracts/src/index.ts`: typed payment parameters and recharge configuration.
- `apps/miniapp/scripts/build-configuration.mjs`, `apps/miniapp/scripts/build-configuration.test.mjs`, `apps/miniapp/scripts/build.mjs`: production-test mode and customer-only output.
- `apps/miniapp/src/services/build-config.d.ts`, `apps/miniapp/src/services/client.ts`, `apps/miniapp/src/services/types.ts`, `apps/miniapp/src/services/http-client.ts`, `apps/miniapp/src/services/mock-client.ts`: build flags and recharge configuration client.
- `apps/miniapp/src/pages/home/index.ts`, `apps/miniapp/src/pages/home/index.wxml`, `apps/miniapp/src/pages/home/index.wxss`: live payment flow and test warning.
- `apps/miniapp/package.json`: include the new payment service test.
- `apps/miniapp/project.config.json`: official AppID and legal-domain checking.
- `infra/deploy/compose.production.yml`, `infra/deploy/production.env.example`: test-only payment settings and read-only secret mount.
- `config/public-endpoints.example.json`, `apps/miniapp/README.md`: production-test build inputs and owner checklist.

No database migration is required: `wechat_recharge_order` already has unique merchant order and provider transaction IDs, while `payment_callback_inbox` already supplies provider-event idempotency.

---

### Task 1: Lock the Customer-Only Production-Test Build

**Files:**

- Modify: `apps/miniapp/scripts/build-configuration.mjs`
- Modify: `apps/miniapp/scripts/build-configuration.test.mjs`
- Modify: `apps/miniapp/scripts/build.mjs`
- Modify: `apps/miniapp/src/services/build-config.d.ts`
- Modify: `apps/miniapp/src/services/client.ts`
- Modify: `apps/miniapp/src/pages/home/index.ts`
- Modify: `apps/miniapp/project.config.json`
- Modify: `config/public-endpoints.example.json`

**Interfaces:**

- Produces build mode `production-test-wechat`.
- Produces `ZyAppMiniappBuildConfig` fields:

```ts
type ZyAppMiniappBuildConfig = {
  useMock: boolean
  testVirtualPhoneEnabled: boolean
  authMode: 'development' | 'wechat'
  apiBaseUrl: string
  storeId: string
  developmentProviderSubject: string
  customerOnly: boolean
  realWechatPayment: boolean
}
```

- Produces `isCustomerOnlyBuild(): boolean` and `isRealWechatPaymentBuild(): boolean`.

- [ ] **Step 1: Write failing build-configuration tests**

Add tests proving the mode requires the exact HTTPS test endpoint, real WeChat auth, virtual phone off, and no development subject:

```js
test('builds the customer-only production test against judian.icu', () => {
  const result = readBuildConfiguration(
    {
      ZYAPP_MINIAPP_MODE: 'production-test-wechat',
      ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED: 'false'
    },
    {
      miniappTestApiBaseUrl: 'https://judian.icu/test',
      miniappTestStoreId: '11111111-1111-4111-8111-111111111111'
    }
  )

  assert.deepEqual(result.configuration, {
    useMock: false,
    testVirtualPhoneEnabled: false,
    authMode: 'wechat',
    apiBaseUrl: 'https://judian.icu/test',
    storeId: '11111111-1111-4111-8111-111111111111',
    developmentProviderSubject: '',
    customerOnly: true,
    realWechatPayment: true
  })
})

for (const invalidUrl of [
  'http://judian.icu/test',
  'https://124.220.69.209/test',
  'https://judian.icu'
]) {
  test(`rejects production-test endpoint ${invalidUrl}`, () => {
    assert.throws(
      () =>
        readBuildConfiguration(
          { ZYAPP_MINIAPP_MODE: 'production-test-wechat' },
          {
            miniappTestApiBaseUrl: invalidUrl,
            miniappTestStoreId: '11111111-1111-4111-8111-111111111111'
          }
        ),
      /https:\/\/judian\.icu\/test/
    )
  })
}
```

- [ ] **Step 2: Run the build tests and confirm failure**

Run:

```powershell
node --test apps/miniapp/scripts/build-configuration.test.mjs
```

Expected: FAIL because `production-test-wechat`, `customerOnly`, and `realWechatPayment` do not exist.

- [ ] **Step 3: Implement the production-test build gate**

Extend accepted modes and apply these invariants:

```js
const productionTest = mode === 'production-test-wechat'
if (productionTest && apiBaseUrl !== 'https://judian.icu/test') {
  throw new Error(
    'production-test-wechat must use https://judian.icu/test'
  )
}
if (productionTest && authMode !== 'wechat') {
  throw new Error('production-test-wechat must use WeChat authentication')
}
if (productionTest && testVirtualPhoneEnabled) {
  throw new Error('production-test-wechat forbids virtual phone login')
}

configuration.customerOnly = productionTest
configuration.realWechatPayment = productionTest
configuration.developmentProviderSubject = productionTest
  ? ''
  : configuredDevelopmentSubject
```

After copying assets, filter `dist/app.json` and remove excluded output directories only for `customerOnly`:

```js
const employeePages = new Set([
  'pages/staff/index',
  'pages/manager/index',
  'pages/content/index'
])
manifest.pages = manifest.pages.filter((page) => !employeePages.has(page))
for (const directory of ['staff', 'manager', 'content']) {
  rmSync(join(output, 'pages', directory), { recursive: true, force: true })
}
```

Guard employee redirects in `home/index.ts` with `isCustomerOnlyBuild()`.

- [ ] **Step 4: Set release-safe project configuration**

Set `setting.urlCheck` to `true`. Set `appid` to the same `WECHAT_MINIAPP_APP_ID` already present in the ignored `infra/deploy/production.env`; compare without printing either value. The AppID is public, but AppSecret must remain untouched.

Add `miniappAppId` to `config/public-endpoints.example.json` so future workstations can keep the non-secret AppID beside the test endpoint.

- [ ] **Step 5: Run focused and full miniapp build tests**

Run:

```powershell
node --test apps/miniapp/scripts/build-configuration.test.mjs
$env:ZYAPP_MINIAPP_MODE='production-test-wechat'
$env:ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED='false'
$env:ZYAPP_MINIAPP_API_BASE_URL='https://judian.icu/test'
corepack pnpm miniapp:build
Remove-Item Env:\ZYAPP_MINIAPP_MODE
Remove-Item Env:\ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED
Remove-Item Env:\ZYAPP_MINIAPP_API_BASE_URL
```

Expected: PASS; `dist/app.json` contains only home, activities, and member pages; the build log says `production-test-wechat`.

- [ ] **Step 6: Commit**

```powershell
git add apps/miniapp/scripts apps/miniapp/src/services/build-config.d.ts apps/miniapp/src/services/client.ts apps/miniapp/src/pages/home/index.ts apps/miniapp/project.config.json config/public-endpoints.example.json
git commit -m "feat: add production test miniapp build"
```

---

### Task 2: Add Strict Real-Payment Configuration and Secret Loading

**Files:**

- Create: `apps/api/src/secret-file.ts`
- Create: `apps/api/src/secret-file.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`

**Interfaces:**

- Produces:

```ts
export function readSingleLineSecret(
  path: string,
  name: string,
  expectedLength?: number
): string
```

- Extends `ApiConfig`:

```ts
wechatPaymentMode: 'mock' | 'wechat' | 'disabled'
wechatPayMerchantId: string | null
wechatPayMerchantCertificateSerial: string | null
wechatPayMerchantPrivateKeyPath: string | null
wechatPayPublicKeyId: string | null
wechatPayPublicKeyPath: string | null
wechatPayApiV3KeyPath: string | null
wechatPayNotifyUrl: string | null
wechatPayOutTradeNoPrefix: string
wechatPaymentTestAmountFen: number | null
```

- [ ] **Step 1: Write failing secret-file tests**

Use a temporary directory and never use real secret files:

```ts
it('reads exactly one 32-character APIv3 line', () => {
  const path = join(directory, 'apiv3.key')
  writeFileSync(path, 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6\n')
  expect(readSingleLineSecret(path, 'WECHAT_PAY_API_V3_KEY_FILE', 32))
    .toBe('A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6')
})

it('rejects multiline secrets', () => {
  writeFileSync(path, 'first-line\nsecond-line\n')
  expect(() => readSingleLineSecret(path, 'secret')).toThrow(/single line/)
})
```

- [ ] **Step 2: Write failing configuration tests**

Cover:

```ts
it('requires every WeChat Pay v3 setting in wechat mode', () => {
  expect(() =>
    readApiConfig(baseEnvironment({ WECHAT_PAYMENT_MODE: 'wechat' }))
  ).toThrow(/WECHAT_PAY_MERCHANT_ID/)
})

it('allows the one-cent tier only in the test deployment', () => {
  expect(() =>
    readApiConfig(
      completeWechatEnvironment({
        DEPLOYMENT_ENVIRONMENT: 'production',
        WECHAT_PAYMENT_TEST_AMOUNT_FEN: '1'
      })
    )
  ).toThrow(/only allowed in the test deployment/)
})

it('accepts real payment in the isolated test deployment', () => {
  const config = readApiConfig(
    completeWechatEnvironment({
      DEPLOYMENT_ENVIRONMENT: 'test',
      WECHAT_PAYMENT_TEST_AMOUNT_FEN: '1'
    })
  )
  expect(config.wechatPaymentMode).toBe('wechat')
  expect(config.wechatPaymentTestAmountFen).toBe(1)
})
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```powershell
corepack pnpm test -- apps/api/src/secret-file.test.ts apps/api/src/config.test.ts
```

Expected: FAIL because the loader and `wechat` mode are absent.

- [ ] **Step 4: Implement validation**

Require all payment fields when mode is `wechat`. Validate:

- merchant ID is digits only;
- merchant certificate serial is hexadecimal;
- public key ID begins with `PUB_KEY_ID_`;
- notification URL is exactly `https://judian.icu/test/v1/payments/wechat/recharge/notify` for the test deployment;
- out-trade prefix is uppercase letters/digits/hyphens and no longer than 8 characters;
- test amount is a positive safe integer and only allowed with `deploymentEnvironment=test` and `wechatPaymentMode=wechat`;
- `MINIAPP_TEST_VIRTUAL_PHONE` is absent in the production-test deployment.

Do not read key contents in `readApiConfig`; paths are validated and secrets are loaded only when constructing the real provider.

- [ ] **Step 5: Run tests and typecheck**

Run:

```powershell
corepack pnpm test -- apps/api/src/secret-file.test.ts apps/api/src/config.test.ts
corepack pnpm --filter @zyapp/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/api/src/secret-file.ts apps/api/src/secret-file.test.ts apps/api/src/config.ts apps/api/src/config.test.ts
git commit -m "feat: validate WeChat Pay v3 configuration"
```

---

### Task 3: Implement and Verify WeChat Pay Cryptography

**Files:**

- Create: `apps/api/src/wechatpay-crypto.ts`
- Create: `apps/api/src/wechatpay-crypto.test.ts`

**Interfaces:**

- Produces:

```ts
export function buildAuthorization(input: {
  method: string
  requestTarget: string
  body: string
  merchantId: string
  merchantCertificateSerial: string
  privateKeyPem: string
  timestamp: string
  nonce: string
}): string

export function signJsapiParameters(input: {
  appId: string
  prepayId: string
  privateKeyPem: string
  timestamp: string
  nonce: string
}): {
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'RSA'
  paySign: string
}

export function verifyWechatPaySignature(input: {
  timestamp: string
  nonce: string
  body: string
  signatureBase64: string
  publicKeyPem: string
}): void

export function decryptNotificationResource(input: {
  ciphertext: string
  associatedData: string
  nonce: string
  apiV3Key: string
}): string
```

- [ ] **Step 1: Write generated-key signing tests**

Generate an RSA-2048 pair inside the test, extract the signature from Authorization, and verify this exact canonical message:

```ts
const message =
  'POST\n/v3/pay/transactions/jsapi\n1721880000\nfixednonce\n{"amount":{"total":1}}\n'

const authorization = buildAuthorization({
  method: 'POST',
  requestTarget: '/v3/pay/transactions/jsapi',
  body: '{"amount":{"total":1}}',
  merchantId: '1748654937',
  merchantCertificateSerial: '5A287A96C7BCD2AC8089D405F7478385C4902A7B',
  privateKeyPem,
  timestamp: '1721880000',
  nonce: 'fixednonce'
})

expect(verify('RSA-SHA256', Buffer.from(message), publicKeyPem, signature))
  .toBe(true)
```

Also verify JSAPI signs:

```ts
const message = `wx-test-appid\n1721880000\nfixednonce\nprepay_id=wx-prepay\n`
```

- [ ] **Step 2: Write signature and AES-GCM rejection tests**

Cover valid signatures, modified body rejection, wrong public key rejection, valid AES-256-GCM resource decryption, modified authentication tag rejection, and APIv3 keys not exactly 32 bytes.

- [ ] **Step 3: Run tests and confirm failure**

Run:

```powershell
corepack pnpm test -- apps/api/src/wechatpay-crypto.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement the minimal crypto module**

Use only:

```ts
import {
  createDecipheriv,
  createSign,
  createVerify,
  timingSafeEqual
} from 'node:crypto'
```

Always preserve the terminal newline in signing canonical strings. Decode WeChat signatures as base64. Throw generic verification errors that do not include keys, plaintext, or full signatures.

- [ ] **Step 5: Run crypto tests and API typecheck**

Run:

```powershell
corepack pnpm test -- apps/api/src/wechatpay-crypto.test.ts
corepack pnpm --filter @zyapp/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/api/src/wechatpay-crypto.ts apps/api/src/wechatpay-crypto.test.ts
git commit -m "feat: add WeChat Pay v3 cryptography"
```

---

### Task 4: Implement the Signed WeChat Pay Provider

**Files:**

- Create: `apps/api/src/wechatpay-provider.ts`
- Create: `apps/api/src/wechatpay-provider.test.ts`
- Modify: `apps/api/src/wechat-payment-provider.ts`
- Modify: `apps/api/src/infrastructure.module.ts`

**Interfaces:**

- Extends the provider contract:

```ts
export type WechatPaymentState =
  | { state: 'pending'; outTradeNo: string }
  | { state: 'closed'; outTradeNo: string }
  | {
      state: 'success'
      outTradeNo: string
      transactionId: string
      amountFen: number
      currency: 'CNY'
      appId: string
      merchantId: string
      payerOpenId: string
      paidAt: string
    }

export type VerifiedWechatPaymentNotification = {
  eventId: string
  eventType: 'TRANSACTION.SUCCESS'
  payload: unknown
  payment: Extract<WechatPaymentState, { state: 'success' }>
}

export interface WechatPaymentProvider {
  readonly mode: 'mock' | 'wechat' | 'disabled'
  createRechargePayment(
    input: CreateWechatRechargePaymentInput
  ): Promise<CreatedWechatRechargePayment>
  queryRechargePayment(outTradeNo: string): Promise<WechatPaymentState>
  closeRechargePayment(outTradeNo: string): Promise<'closed' | 'paid'>
  verifyNotification(input: {
    headers: Record<string, string | string[] | undefined>
    rawBody: string
  }): VerifiedWechatPaymentNotification
}
```

- [ ] **Step 1: Write a deterministic signed-create test**

Inject `fetch`, clock, and nonce. Assert the provider sends:

```ts
expect(JSON.parse(request.body)).toEqual({
  appid: 'wx-test-appid',
  mchid: '1748654937',
  description: '桌游吧会员储值',
  out_trade_no: 'ZYT-ORDER-1',
  time_expire: '2026-07-25T12:15:00+08:00',
  notify_url:
    'https://judian.icu/test/v1/payments/wechat/recharge/notify',
  amount: { total: 1, currency: 'CNY' },
  payer: { openid: 'openid-test' }
})
expect(request.headers.Authorization).toMatch(
  /^WECHATPAY2-SHA256-RSA2048 /
)
```

Return a generated-key signed response containing `{"prepay_id":"wx-prepay"}` and assert the provider returns `signType: 'RSA'`.

- [ ] **Step 2: Write query, close, and notification tests**

Cover:

- signed `SUCCESS` query mapping;
- `NOTPAY` mapping to pending;
- `CLOSED` mapping to closed;
- close `204` mapping to closed;
- close `ORDERPAID` mapping to paid;
- response signature failure before JSON trust;
- unknown `Wechatpay-Serial` rejection;
- notification header signature validation before AES-GCM decryption;
- merchant/app/payment fields returned without silent coercion.

- [ ] **Step 3: Run tests and confirm failure**

Run:

```powershell
corepack pnpm test -- apps/api/src/wechatpay-provider.test.ts
```

Expected: FAIL because `WechatPayProvider` does not exist.

- [ ] **Step 4: Implement provider HTTP boundaries**

Use these API paths:

```ts
const createPath = '/v3/pay/transactions/jsapi'
const queryPath = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(
  outTradeNo
)}?mchid=${encodeURIComponent(merchantId)}`
const closePath = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(
  outTradeNo
)}/close`
```

Read the raw response text, verify `Wechatpay-Timestamp`, `Wechatpay-Nonce`, `Wechatpay-Signature`, and `Wechatpay-Serial`, then parse JSON. Never log Authorization, raw notification content, OpenID, or signatures.

Construct the real provider in `InfrastructureModule` only when mode is `wechat`. Load the APIv3 key and merchant private key through `readSingleLineSecret` or a PEM-specific non-logging reader; verify the configured public/private files exist before serving.

- [ ] **Step 5: Run provider tests and all API payment tests**

Run:

```powershell
corepack pnpm test -- apps/api/src/wechatpay-provider.test.ts apps/api/src/wechatpay-crypto.test.ts apps/api/src/config.test.ts
corepack pnpm --filter @zyapp/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/api/src/wechatpay-provider.ts apps/api/src/wechatpay-provider.test.ts apps/api/src/wechat-payment-provider.ts apps/api/src/infrastructure.module.ts
git commit -m "feat: add WeChat Pay JSAPI provider"
```

---

### Task 5: Feed Verified Payment Results into the Existing Ledger

**Files:**

- Create: `apps/api/src/wechat-payment.controller.ts`
- Create: `apps/api/src/wechat-payment.controller.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/member-recharge.service.ts`
- Modify: `apps/api/src/member-recharge.service.test.ts`
- Modify: `apps/api/src/member-self-service.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`

**Interfaces:**

- Adds contract:

```ts
export type MemberRechargeConfiguration = {
  providerMode: 'mock' | 'wechat'
  testAmountFen: number | null
}

export type WechatJsapiPaymentParameters = {
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'RSA'
  paySign: string
}
```

- Adds member endpoint `GET /v1/member/recharge-configuration`.
- Adds public notification endpoint `POST /v1/payments/wechat/recharge/notify`.
- Produces service methods:

```ts
getConfiguration(
  principal: MiniappPrincipal
): MemberRechargeConfiguration

handleWechatNotification(
  notification: VerifiedWechatPaymentNotification
): Promise<MemberRechargeOrderSummary>

refreshWechatOrder(
  principal: MiniappPrincipal,
  orderId: string
): Promise<MemberRechargeOrderSummary>
```

- `MemberRechargeService` additionally consumes `API_CONFIG` so it can compare
  the verified AppID and merchant ID, read the test amount, and generate the
  environment-prefixed merchant order number.

- [ ] **Step 1: Write failing test-tier tests**

Assert:

```ts
expect(service.getConfiguration(memberPrincipal)).toEqual({
  providerMode: 'wechat',
  testAmountFen: 1
})
```

For a `1` fen order, assert the insert snapshot contains zero gift and no membership grant SQL is executed after settlement. For `WECHAT_PAYMENT_TEST_AMOUNT_FEN=null`, creating a one-fen order must throw `BadRequestException`.

- [ ] **Step 2: Write failing verified-settlement tests**

Add cases for:

```ts
await service.handleWechatNotification({
  eventId: 'event-1',
  eventType: 'TRANSACTION.SUCCESS',
  payload: signedPayload,
  payment: {
    state: 'success',
    outTradeNo: 'ZYT-ORDER-1',
    transactionId: '4200000001202607250000000001',
    amountFen: 1,
    currency: 'CNY',
    appId: 'wx-test-appid',
    merchantId: '1748654937',
    payerOpenId: 'openid-test',
    paidAt: '2026-07-25T12:01:00+08:00'
  }
})
```

Assert exact out-trade number, principal amount, AppID, merchant ID, and payer OpenID matching. Add rejection tests for each mismatch. Run the same notification twice and assert one wallet ledger insert. Race a notification and active query and assert one settlement.

Change the existing expired-order test: a verified successful payment received after local `expires_at` must settle; local time alone must not reject real money.

- [ ] **Step 3: Write failing query-and-close tests**

For `getOrder` on a WeChat `pending_payment` order:

- provider success invokes the same settlement boundary;
- provider pending returns pending before expiry;
- provider pending after expiry calls close;
- close returns `paid`, then re-query and settle;
- close returns `closed`, then mark expired;
- provider/network failure leaves the local order pending and returns a safe confirmation-in-progress response rather than creating a new order.

- [ ] **Step 4: Write failing notification-controller tests**

Create a Nest testing module with a fake provider and assert:

```ts
expect(provider.verifyNotification).toHaveBeenCalledWith({
  headers: expect.any(Object),
  rawBody: exactRawJson
})
expect(response.status).toBe(204)
expect(response.text).toBe('')
```

Invalid signatures must return a `4xx` response with
`{ code: 'FAIL', message: 'invalid notification' }` and never call
`handleWechatNotification`.

- [ ] **Step 5: Run focused tests and confirm failure**

Run:

```powershell
corepack pnpm test -- apps/api/src/member-recharge.service.test.ts apps/api/src/wechat-payment.controller.test.ts
```

Expected: FAIL because the configuration, verified-result, query, and controller methods are absent.

- [ ] **Step 6: Implement the financial boundary**

Refactor without changing existing ledger semantics:

- resolve callback order by unique `out_trade_no`;
- compare merchant/AppID/OpenID/currency/amount before starting ledger writes;
- lock and read the order's `miniapp_identity.provider_subject` to compare it
  with the verified payer OpenID;
- use the provider event ID for `payment_callback_inbox`;
- persist the actual WeChat transaction ID;
- use WeChat `success_time` as `paid_at`;
- remove the clock-only expiry branch from `settlePaidOrder`;
- allow `creating` recovery only after a signed successful query;
- maintain `FOR UPDATE`, unique transaction ID, and inbox conflict checks;
- return success for an already-settled identical event.

Generate a merchant order number no longer than 32 characters:

```ts
const compactOrderId = orderId.replaceAll('-', '')
const outTradeNo =
  config.wechatPayOutTradeNoPrefix +
  compactOrderId.slice(0, 32 - config.wechatPayOutTradeNoPrefix.length)
```

Initialize Nest with:

```ts
const app = await NestFactory.create(AppModule, { rawBody: true })
```

Use `RawBodyRequest<Request>` in the controller and reject requests without `rawBody`.

- [ ] **Step 7: Run financial and API regression tests**

Run:

```powershell
corepack pnpm test -- apps/api/src/member-recharge.service.test.ts apps/api/src/wechat-payment.controller.test.ts apps/api/src/wechatpay-provider.test.ts
corepack pnpm --filter @zyapp/api typecheck
corepack pnpm --filter @zyapp/api build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add packages/contracts/src/index.ts apps/api/src/member-recharge.service.ts apps/api/src/member-recharge.service.test.ts apps/api/src/wechat-payment.controller.ts apps/api/src/wechat-payment.controller.test.ts apps/api/src/member-self-service.controller.ts apps/api/src/app.module.ts apps/api/src/main.ts
git commit -m "feat: settle verified WeChat recharge payments"
```

---

### Task 6: Invoke Real Payment and Poll Authoritative State in the Miniapp

**Files:**

- Create: `apps/miniapp/src/services/wechat-payment.ts`
- Create: `apps/miniapp/src/services/wechat-payment.test.ts`
- Modify: `apps/miniapp/src/services/types.ts`
- Modify: `apps/miniapp/src/services/http-client.ts`
- Modify: `apps/miniapp/src/services/http-client.test.ts`
- Modify: `apps/miniapp/src/services/mock-client.ts`
- Modify: `apps/miniapp/src/pages/home/index.ts`
- Modify: `apps/miniapp/src/pages/home/index.wxml`
- Modify: `apps/miniapp/src/pages/home/index.wxss`
- Modify: `apps/miniapp/package.json`

**Interfaces:**

- Adds `getRechargeConfiguration(): Promise<MemberRechargeConfiguration>` to `MiniappClient`.
- Produces:

```ts
export function parseWechatPaymentParameters(
  value: Record<string, string> | null
): WechatJsapiPaymentParameters

export function requestWechatPayment(
  parameters: WechatJsapiPaymentParameters,
  invoke?: typeof wx.requestPayment
): Promise<'completed' | 'cancelled'>

export function pollRechargeOrder(input: {
  orderId: string
  getOrder: (orderId: string) => Promise<MemberRechargeOrderSummary>
  wait?: (milliseconds: number) => Promise<void>
  delays?: readonly number[]
}): Promise<MemberRechargeOrderSummary>
```

- [ ] **Step 1: Write failing parameter-validation tests**

Accept only:

```ts
{
  timeStamp: '1721880000',
  nonceStr: 'fixednonce',
  package: 'prepay_id=wx-prepay',
  signType: 'RSA',
  paySign: 'base64-signature'
}
```

Reject `MOCK`, missing `prepay_id=`, empty signatures, extra non-string values, and null.

- [ ] **Step 2: Write failing request and polling tests**

Test:

- `wx.requestPayment` receives exactly the five server parameters;
- `requestPayment:ok` returns `completed`;
- `requestPayment:fail cancel` returns `cancelled`;
- other failures reject;
- polling stops on `settled`, `failed`, or `expired`;
- polling uses delays `[0, 800, 1500, 2500, 4000]`;
- exhausted pending polling returns the last pending order without claiming success.

- [ ] **Step 3: Run tests and confirm failure**

Run:

```powershell
corepack pnpm --filter @zyapp/miniapp test
```

Expected: FAIL because `wechat-payment.ts` and its test entry do not exist.

- [ ] **Step 4: Implement the HTTP client and payment service**

Add:

```ts
getRechargeConfiguration(): Promise<MemberRechargeConfiguration> {
  return this.request('/v1/member/recharge-configuration')
}
```

Implement Promise wrapping around `wx.requestPayment`. Do not update member balance in this service.

- [ ] **Step 5: Replace create-only recharge UI with create-pay-confirm**

In `performRecharge`:

1. create the order using one stable request ID;
2. display the order immediately;
3. for provider `wechat`, validate payment parameters and call `requestWechatPayment`;
4. poll `getRechargeOrder` even when the user cancels;
5. update order display from server status;
6. reload member summary and history only after `settled`;
7. show “支付结果确认中” when polling ends pending.

Prepend the server-provided one-cent option:

```ts
const testOption =
  rechargeConfiguration.testAmountFen === 1
    ? [{
        id: 'recharge-live-test-1',
        label: '真实支付测试',
        principalFen: 1,
        priceText: '¥0.01',
        giftText: '无赠送',
        totalText: '测试库到账 ¥0.01',
        testOnly: true
      }]
    : []
```

Add a visible warning:

`真实扣款，资金进入商户号；余额仅写入测试库。`

Keep the Mock settle button only when `providerMode === 'mock'`; the production-test build cannot receive Mock parameters.

- [ ] **Step 6: Run miniapp verification**

Run:

```powershell
corepack pnpm miniapp:typecheck
corepack pnpm miniapp:test
$env:ZYAPP_MINIAPP_MODE='production-test-wechat'
$env:ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED='false'
$env:ZYAPP_MINIAPP_API_BASE_URL='https://judian.icu/test'
corepack pnpm miniapp:build
Remove-Item Env:\ZYAPP_MINIAPP_MODE
Remove-Item Env:\ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED
Remove-Item Env:\ZYAPP_MINIAPP_API_BASE_URL
```

Expected: PASS; build output contains no Mock settlement call and no employee routes.

- [ ] **Step 7: Commit**

```powershell
git add apps/miniapp/src/services apps/miniapp/src/pages/home apps/miniapp/package.json
git commit -m "feat: complete real miniapp recharge flow"
```

---

### Task 7: Add Dual TLS and Test-Only Secret Deployment

**Files:**

- Create: `infra/deploy/Caddyfile.dual-https`
- Create: `infra/scripts/deploy-miniapp-production-test.ps1`
- Modify: `infra/deploy/compose.production.yml`
- Modify: `infra/deploy/production.env.example`
- Modify: `apps/miniapp/README.md`

**Interfaces:**

- Caddy variables: `APP_IP=124.220.69.209`, `MINIAPP_DOMAIN=judian.icu`.
- Test container secret paths:

```text
/run/secrets/wechatpay/apiv3.key
/run/secrets/wechatpay/apiclient_cert.pem
/run/secrets/wechatpay/apiclient_key.pem
/run/secrets/wechatpay/wechatpay_public_key.pem
```

- Deployment script mandatory secret inputs:

```powershell
param(
  [string]$HostName,
  [string]$KeyPath,
  [string]$EnvironmentPath,
  [string]$ApiV3KeyPath,
  [string]$MerchantCertificatePath,
  [string]$MerchantPrivateKeyPath,
  [string]$WechatPayPublicKeyPath
)
```

- [ ] **Step 1: Write the dual-site Caddy configuration**

Use one imported routing snippet:

```caddyfile
{
  default_sni {$APP_IP}
}

(zyapp_routes) {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=604800"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "no-referrer"
    -Server
    -X-Powered-By
  }
  handle_path /test/* {
    reverse_proxy api-test:3100
  }
  handle {
    reverse_proxy api:3100
  }
  log {
    output stdout
    format json
  }
}

{$APP_IP} {
  tls {
    issuer acme {
      dir {$ACME_CA}
      profile shortlived
    }
  }
  import zyapp_routes
}

{$MINIAPP_DOMAIN} {
  import zyapp_routes
}
```

- [ ] **Step 2: Configure only `api-test` for real payment**

Keep production:

```yaml
WECHAT_PAYMENT_MODE: disabled
```

Add to `api-test`:

```yaml
WECHAT_PAYMENT_MODE: ${TEST_WECHAT_PAYMENT_MODE:-disabled}
WECHAT_PAY_MERCHANT_ID: ${WECHAT_PAY_MERCHANT_ID:-}
WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL: ${WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL:-}
WECHAT_PAY_MERCHANT_PRIVATE_KEY_FILE: /run/secrets/wechatpay/apiclient_key.pem
WECHAT_PAY_PUBLIC_KEY_ID: ${WECHAT_PAY_PUBLIC_KEY_ID:-}
WECHAT_PAY_PUBLIC_KEY_FILE: /run/secrets/wechatpay/wechatpay_public_key.pem
WECHAT_PAY_API_V3_KEY_FILE: /run/secrets/wechatpay/apiv3.key
WECHAT_PAY_NOTIFY_URL: https://judian.icu/test/v1/payments/wechat/recharge/notify
WECHAT_PAY_OUT_TRADE_NO_PREFIX: ZYT-
WECHAT_PAYMENT_TEST_AMOUNT_FEN: "1"
MINIAPP_TEST_VIRTUAL_PHONE: ""
```

Mount:

```yaml
- ${WECHATPAY_SECRETS_DIRECTORY:-/opt/zyapp/secrets/wechatpay}:/run/secrets/wechatpay:ro
```

Add Caddy `APP_IP` and `MINIAPP_DOMAIN` environment variables and select `./Caddyfile.dual-https`.

- [ ] **Step 3: Implement non-echoing secret deployment**

The script must:

- resolve and verify all local paths;
- validate the APIv3 file contains one 32-character ASCII alphanumeric line without printing it;
- create a fresh local archive excluding `.git`, `.tmp`, `production.env`, and all secret directories;
- upload four files under fixed temporary names;
- install them under `/opt/zyapp/secrets/wechatpay` with owner `root`, directory mode `0700`, and file mode `0600`;
- upload `production.env` with mode `0600`;
- back up the test database before container changes;
- build and migrate `migrate-test` and `api-test`;
- recreate `api-test` and Caddy only;
- leave `api`, `worker`, production database, and PC update files untouched;
- remove remote temporary secret copies after installation, including on failure.

Never use `Get-Content`, `Write-Output`, shell tracing, or interpolated command text on secret contents.

- [ ] **Step 4: Validate Compose and Caddy locally**

Use a generated validation environment containing dummy paths and dummy identifiers, never real secrets:

```powershell
docker compose --env-file .tmp/compose-validation.env `
  -f infra/deploy/compose.production.yml config --quiet
docker run --rm `
  -e APP_IP=124.220.69.209 `
  -e MINIAPP_DOMAIN=judian.icu `
  -e ACME_CA=https://acme-v02.api.letsencrypt.org/directory `
  -v "${PWD}/infra/deploy/Caddyfile.dual-https:/etc/caddy/Caddyfile:ro" `
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
```

Expected: both commands exit `0`.

- [ ] **Step 5: Update operational documentation**

Document:

- WeChat request legal domain is `https://judian.icu`;
- upload/download/socket domains remain empty;
- production-test build command;
- real payment uses the test database but real money;
- only the account owner can complete phone authorization, payment, preview, privacy review, and release;
- the APIv3 key path is requested at deployment time and must never be pasted into chat.

- [ ] **Step 6: Commit**

```powershell
git add infra/deploy/Caddyfile.dual-https infra/deploy/compose.production.yml infra/deploy/production.env.example infra/scripts/deploy-miniapp-production-test.ps1 apps/miniapp/README.md
git commit -m "ops: deploy miniapp test payment safely"
```

---

### Task 8: Verify, Deploy, and Hand Off the One-Cent Test

**Files:**

- Modify locally but do not commit: `config/public-endpoints.local.json`
- Modify locally but do not commit: `infra/deploy/production.env`
- Produce ignored artifact: `apps/miniapp/dist/**`
- Preserve without committing: `infra/deploy/production.env.before-domain-20260725`

**Interfaces:**

- The local endpoint file contains `https://judian.icu/test`, the existing test store ID, and the official AppID.
- The deployment environment enables payment only for `api-test`.
- The user supplies the absolute path of a new one-line APIv3 key file; the key
  value is never sent through chat.
- The user supplies the non-secret `PUB_KEY_ID_...` identifier copied from the
  merchant platform or a newly created clean one-line ID file.
- The merchant-platform “微信支付公钥” switch is enabled and its switch
  progress is complete before the provider is deployed; otherwise responses
  can still be signed by a platform certificate that this public-key-only
  provider intentionally does not trust.

- [ ] **Step 1: Run the full local verification floor**

Run:

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm cloud:build
corepack pnpm miniapp:typecheck
corepack pnpm miniapp:test
$env:ZYAPP_MINIAPP_MODE='production-test-wechat'
$env:ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED='false'
$env:ZYAPP_MINIAPP_API_BASE_URL='https://judian.icu/test'
corepack pnpm miniapp:build
Remove-Item Env:\ZYAPP_MINIAPP_MODE
Remove-Item Env:\ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED
Remove-Item Env:\ZYAPP_MINIAPP_API_BASE_URL
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 2: Run a secret and build-output audit**

Search tracked and built files for forbidden material names and Mock release paths, not secret values:

```powershell
rg -n "BEGIN (RSA )?PRIVATE KEY|WECHAT_PAY_API_V3_KEY|apiclient_key|test-virtual-phone|mock-settle" `
  apps/miniapp/dist apps/api/dist
git status --short
```

Expected:

- no private key or APIv3 key appears;
- production-test miniapp contains no `test-virtual-phone` or `mock-settle`;
- only intentional source changes are committed;
- the ignored environment backup remains uncommitted.

- [ ] **Step 3: Update ignored local endpoint and environment files**

Set:

```text
miniappTestApiBaseUrl=https://judian.icu/test
APP_IP=124.220.69.209
MINIAPP_DOMAIN=judian.icu
CADDYFILE_PATH=./Caddyfile.dual-https
TEST_WECHAT_PAYMENT_MODE=wechat
WECHATPAY_SECRETS_DIRECTORY=/opt/zyapp/secrets/wechatpay
WECHAT_PAY_MERCHANT_ID=1748654937
WECHAT_PAY_MERCHANT_CERTIFICATE_SERIAL=5A287A96C7BCD2AC8089D405F7478385C4902A7B
WECHAT_PAY_NOTIFY_URL=https://judian.icu/test/v1/payments/wechat/recharge/notify
WECHAT_PAY_OUT_TRADE_NO_PREFIX=ZYT-
WECHAT_PAYMENT_TEST_AMOUNT_FEN=1
TEST_MINIAPP_VIRTUAL_PHONE=
```

Copy the public key ID supplied from the merchant platform into
`WECHAT_PAY_PUBLIC_KEY_ID` without reading the old mixed-content text file.
Preserve all existing database, Redis, device, phone, AppID, and AppSecret
values.

- [ ] **Step 4: Obtain the remaining user inputs safely**

Ask the user for:

- the absolute path of the new one-line APIv3 key file, never the key value;
- the public `PUB_KEY_ID_...` string copied from the merchant platform, or the
  path to a newly created clean file containing only that ID;
- confirmation from “商户平台 → 账户中心 → API安全 → 微信支付公钥 → 管理公钥”
  that the public-key switch is enabled and the switch progress is complete.

Use the already known files:

```text
E:\证书\API证书\apiclient_cert.pem
E:\证书\API证书\apiclient_key.pem
E:\证书\pub_key.pem
```

Stop before deployment if the new APIv3 key file path, clean public key ID, or
completed public-key switch is unavailable.

- [ ] **Step 5: Deploy test API, secrets, and dual TLS**

Invoke `infra/scripts/deploy-miniapp-production-test.ps1` with:

- host `124.220.69.209`;
- SSH user `ubuntu`;
- key `E:\AIproject\zyApp\.tmp\ssh\kaifa_PC.pem`;
- remote directory `/opt/zyapp`;
- local ignored environment file;
- the four explicit secret/certificate paths.

Expected: the script reports successful test backup, test migration, `api-test` health, and Caddy health without printing secret values.

- [ ] **Step 6: Verify all four public health paths**

Run:

```powershell
$origins = @(
  'https://124.220.69.209/v1/health/ready',
  'https://124.220.69.209/test/v1/health/ready',
  'https://judian.icu/v1/health/ready',
  'https://judian.icu/test/v1/health/ready'
)
foreach ($origin in $origins) {
  $response = Invoke-WebRequest -Uri $origin -UseBasicParsing
  if ($response.StatusCode -ne 200) { throw "Health failed: $origin" }
}
```

Then inspect the server certificate subject for both the IP and domain and confirm no Caddy/API error burst in the last 100 log lines.

- [ ] **Step 7: Account-owner WeChat platform and device acceptance**

The account owner performs:

1. add `https://judian.icu` as the request legal domain;
2. leave socket/upload/download domains empty;
3. open the project with the official AppID and legal-domain checking enabled;
4. complete real `wx.login` and phone authorization;
5. verify wallet, monthly card, and histories come from the test store;
6. pay exactly 0.01 yuan;
7. confirm the transaction in the merchant platform;
8. confirm the test wallet principal increases by exactly 1 fen and gift by 0;
9. refresh and repeat status queries to prove no second credit;
10. confirm the PC still connects through the IP endpoint.

- [ ] **Step 8: Record evidence and stop before formal release**

Record only non-sensitive evidence: order suffix, timestamps, HTTP status, wallet before/after integer fen, one ledger row, one callback inbox row, and merchant-platform success confirmation. Do not record OpenID, phone, full transaction payload, keys, or signatures.

Do not submit for WeChat review or switch payment to the production database in this task.
