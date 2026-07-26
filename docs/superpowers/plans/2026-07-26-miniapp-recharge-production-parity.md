# 小程序体验版与正式版充值功能一致性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让体验版和正式版使用同一套快捷充值、自定义金额及微信支付流程，体验环境允许用户手动输入 0.01 元完成真实支付。

**Architecture:** 删除测试环境强制金额及一分钱专用分支，所有充值金额统一按整数分进入既有幂等订单和赠送规则。小程序用独立纯函数解析金额，在会员首页展示固定快捷金额和自定义输入；两个客户构建只保留 API 与门店环境差异。生产 Compose 补齐可显式启用的微信支付配置，但本次只部署测试 API。

**Tech Stack:** TypeScript 5.9、NestJS 11、原生微信小程序 WXML/WXSS、Vitest 4、Node Test、Docker Compose、微信支付 API v3

## Global Constraints

- 快捷金额固定为 100、300、500、1000 元。
- 自定义金额范围为 0.01–1,000,000.00 元，最多两位小数。
- 金额在客户端和服务端都使用整数分，禁止浮点金额进入财务接口。
- 体验版和正式版使用相同页面、接口、校验、赠送规则和支付状态处理。
- 体验与生产只隔离 API、门店、PostgreSQL、Redis、头像卷、订单前缀和微信支付回调。
- 微信支付结果只能由可信服务端查询或回调结算，钱包流水保持追加式和幂等。
- 本次只重建 `api-test`；不得重启或重建生产 `api` 和 Caddy。
- 体验版真机验收通过前不合并、不推送 Git。

---

### Task 1: 删除测试专用金额契约和服务端分支

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/member-recharge.service.ts`
- Modify: `apps/api/src/member-recharge.service.test.ts`
- Modify: API 测试中构造 `ApiConfig` 的相关测试文件
- Modify: `apps/miniapp/src/services/mock-client.ts`
- Modify: `apps/miniapp/src/services/member-home.test.ts`

**Interfaces:**
- Consumes: `CreateMemberRechargeOrderRequest { requestId: string; principalFen: number }`
- Produces: `MemberRechargeConfiguration { providerMode: 'mock' | 'wechat' }`
- Produces: 统一接受 `principalFen` 为 1–100000000 的真实与 Mock 充值订单。

- [ ] **Step 1: 修改 API 测试，定义无测试专用字段的期望**

将配置测试改为断言旧环境变量不再改变运行契约：

```ts
const config = readApiConfig(
  completeWechatEnvironment({
    WECHAT_PAYMENT_TEST_AMOUNT_FEN: '1'
  })
)
expect(config).not.toHaveProperty('wechatPaymentTestAmountFen')
```

将真实支付配置期望改为：

```ts
expect(service.getConfiguration(principal())).toEqual({
  providerMode: 'wechat'
})
```

将一分钱订单测试改为在没有专用开关时仍创建订单，测试库不返回 1 分赠送档位：

```ts
if (sql.includes('FROM cloud_recharge_gift_tier')) return []

const result = await service.createOrder(principal(), {
  requestId: 'one-cent-order-1',
  principalFen: 1
})

expect(result).toMatchObject({
  principalFen: 1,
  giftFen: 0,
  totalCreditFen: 1
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
corepack pnpm vitest run apps/api/src/config.test.ts apps/api/src/member-recharge.service.test.ts
```

Expected: FAIL；配置仍含 `wechatPaymentTestAmountFen`，且无开关的一分钱订单仍被拒绝。

- [ ] **Step 3: 最小化修改共享契约与 API**

共享契约改为：

```ts
export type MemberRechargeConfiguration = {
  providerMode: 'mock' | 'wechat'
}
```

从 `ApiConfig` 和 `readApiConfig` 删除
`wechatPaymentTestAmountFen`、`WECHAT_PAYMENT_TEST_AMOUNT_FEN` 解析和环境限制。
真实微信支付与测试虚拟手机号冲突改为直接判断：

```ts
if (miniappTestVirtualPhone && wechatPaymentMode === 'wechat') {
  throw new Error('Real WeChat payment forbids MINIAPP_TEST_VIRTUAL_PHONE')
}
```

充值配置只返回：

```ts
return { providerMode: this.paymentProvider.mode }
```

删除创建订单中的一分钱拒绝和 `isLiveTestOrder` 分支；所有金额统一执行现有
`calculateMaximumRechargeGift`，没有命中档位时赠送为 0。

- [ ] **Step 4: 修正所有类型化测试夹具和 Mock 客户端**

删除测试夹具的：

```ts
wechatPaymentTestAmountFen: null
```

Mock 客户端配置改为：

```ts
return { providerMode: 'mock' }
```

- [ ] **Step 5: 运行 API 与契约验证并确认 GREEN**

Run:

```powershell
corepack pnpm vitest run apps/api/src/config.test.ts apps/api/src/member-recharge.service.test.ts
corepack pnpm --filter @zyapp/api typecheck
corepack pnpm miniapp:typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交统一充值金额服务端规则**

```powershell
git add packages/contracts/src/index.ts apps/api/src apps/miniapp/src/services/mock-client.ts apps/miniapp/src/services/member-home.test.ts
git commit -m "fix: unify miniapp recharge amount rules"
```

### Task 2: 实现快捷充值和自定义金额界面

**Files:**
- Create: `apps/miniapp/src/services/recharge-amount.ts`
- Create: `apps/miniapp/src/services/recharge-amount.test.ts`
- Modify: `apps/miniapp/src/pages/home/index.ts`
- Modify: `apps/miniapp/src/pages/home/index.wxml`
- Modify: `apps/miniapp/src/pages/home/index.wxss`
- Modify: `apps/miniapp/package.json`

**Interfaces:**
- Produces: `quickRechargeAmounts: ReadonlyArray<{ principalFen: number; label: string }>`
- Produces: `parseRechargeAmountFen(raw: string): number`
- Produces: `resolveRechargeAmountFen(selectedFen: number | null, customAmount: string): number`

- [ ] **Step 1: 写金额解析失败测试**

```ts
import { describe, expect, it } from 'vitest'
import {
  parseRechargeAmountFen,
  quickRechargeAmounts,
  resolveRechargeAmountFen
} from './recharge-amount'

describe('member recharge amounts', () => {
  it('exposes the approved quick amounts', () => {
    expect(quickRechargeAmounts.map((item) => item.principalFen)).toEqual([
      10_000, 30_000, 50_000, 100_000
    ])
  })

  it.each([
    ['0.01', 1],
    ['1.2', 120],
    ['100', 10_000],
    ['100.00', 10_000],
    ['1000000.00', 100_000_000]
  ])('parses %s yuan as integer fen', (raw, expected) => {
    expect(parseRechargeAmountFen(raw)).toBe(expected)
  })

  it.each(['', '0', '-1', '.01', '1.001', 'abc', '1000000.01'])(
    'rejects invalid amount %s',
    (raw) => expect(() => parseRechargeAmountFen(raw)).toThrow(/充值金额/)
  )

  it('uses custom input instead of a stale quick selection', () => {
    expect(resolveRechargeAmountFen(null, '0.01')).toBe(1)
    expect(resolveRechargeAmountFen(30_000, '')).toBe(30_000)
  })
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
corepack pnpm vitest run apps/miniapp/src/services/recharge-amount.test.ts
```

Expected: FAIL；`recharge-amount` 模块不存在。

- [ ] **Step 3: 实现金额解析纯函数**

```ts
export const quickRechargeAmounts = [
  { principalFen: 10_000, label: '¥100' },
  { principalFen: 30_000, label: '¥300' },
  { principalFen: 50_000, label: '¥500' },
  { principalFen: 100_000, label: '¥1000' }
] as const

export function parseRechargeAmountFen(raw: string): number {
  const normalized = raw.trim()
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error('请输入正确的充值金额，最多两位小数')
  }
  const [yuan, decimal = ''] = normalized.split('.')
  const fen = Number(yuan) * 100 + Number(decimal.padEnd(2, '0'))
  if (!Number.isSafeInteger(fen) || fen < 1 || fen > 100_000_000) {
    throw new Error('充值金额应为 0.01 至 1000000 元')
  }
  return fen
}

export function resolveRechargeAmountFen(
  selectedFen: number | null,
  customAmount: string
): number {
  if (customAmount.trim()) return parseRechargeAmountFen(customAmount)
  if (selectedFen !== null) return selectedFen
  throw new Error('请选择或输入充值金额')
}
```

- [ ] **Step 4: 运行金额测试并确认 GREEN**

Run:

```powershell
corepack pnpm vitest run apps/miniapp/src/services/recharge-amount.test.ts
```

Expected: PASS。

- [ ] **Step 5: 替换首页 ActionSheet 为可见充值卡片**

页面数据加入：

```ts
quickRechargeAmounts,
selectedRechargeAmountFen: 10_000 as number | null,
customRechargeAmount: ''
```

新增事件：

```ts
selectRechargeAmount(event: WechatMiniprogram.TouchEvent) {
  const principalFen = Number(event.currentTarget.dataset.principalFen)
  this.setData({
    selectedRechargeAmountFen: principalFen,
    customRechargeAmount: ''
  })
}

inputCustomRechargeAmount(event: WechatMiniprogram.Input) {
  this.setData({
    selectedRechargeAmountFen: null,
    customRechargeAmount: String(event.detail.value ?? '')
  })
}
```

`recharge()` 使用 `resolveRechargeAmountFen`；校验失败时显示 Toast 并停止，
不得创建订单。WXML 在余额卡下展示四个快捷按钮、自定义金额输入和“微信支付”
按钮；WXSS 增加两列金额网格、选中态和金额输入样式。

- [ ] **Step 6: 把测试加入小程序测试命令并运行**

Run:

```powershell
corepack pnpm miniapp:test
corepack pnpm miniapp:typecheck
```

Expected: PASS。

- [ ] **Step 7: 提交充值界面**

```powershell
git add apps/miniapp/package.json apps/miniapp/src/services/recharge-amount.ts apps/miniapp/src/services/recharge-amount.test.ts apps/miniapp/src/pages/home
git commit -m "feat: add quick and custom miniapp recharge"
```

### Task 3: 对齐正式版、体验版构建与部署配置

**Files:**
- Modify: `apps/miniapp/scripts/build-configuration.mjs`
- Modify: `apps/miniapp/scripts/build-configuration.test.mjs`
- Modify: `infra/deploy/compose.production.yml`
- Modify: `infra/deploy/production.env.example`

**Interfaces:**
- Consumes: `production-test-wechat` 与 `production-wechat` 客户构建模式。
- Produces: 两种客户构建均为 `realWechatPayment: true`。
- Produces: 生产 API 可通过 `PRODUCTION_WECHAT_PAYMENT_MODE=wechat` 显式启用同一微信支付提供方。

- [ ] **Step 1: 写构建配置失败测试**

把正式版期望改为：

```js
realWechatPayment: true
```

新增归一化比较：

```js
const normalize = ({ apiBaseUrl, storeId, ...configuration }) => configuration
assert.deepEqual(
  normalize(production.configuration),
  normalize(productionTest.configuration)
)
```

- [ ] **Step 2: 运行构建配置测试并确认 RED**

Run:

```powershell
node --test apps/miniapp/scripts/build-configuration.test.mjs
```

Expected: FAIL；正式版仍返回 `realWechatPayment: false`。

- [ ] **Step 3: 让两个客户构建启用相同充值功能**

构建配置改为：

```js
realWechatPayment: customerRelease
```

Mock、普通测试和本地开发构建保持原行为。

- [ ] **Step 4: 对齐 Compose 支付能力**

生产 `api` 增加与 `api-test` 相同的商户参数与只读密钥挂载，区别仅为：

```yaml
WECHAT_PAYMENT_MODE: ${PRODUCTION_WECHAT_PAYMENT_MODE:-disabled}
WECHAT_PAY_NOTIFY_URL: https://judian.icu/v1/payments/wechat/recharge/notify
WECHAT_PAY_OUT_TRADE_NO_PREFIX: ZYP-
```

测试 `api-test` 删除：

```yaml
WECHAT_PAYMENT_TEST_AMOUNT_FEN: "1"
```

环境示例增加：

```dotenv
PRODUCTION_WECHAT_PAYMENT_MODE=disabled
TEST_WECHAT_PAYMENT_MODE=wechat
```

测试部署脚本的路由与生产容器保护保持不变。

- [ ] **Step 5: 验证构建配置与脚本语法**

Run:

```powershell
node --test apps/miniapp/scripts/build-configuration.test.mjs
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path 'infra/scripts/deploy-miniapp-production-test.ps1'),
  [ref]$tokens,
  [ref]$errors
) | Out-Null
if ($errors.Count) { throw $errors[0] }
```

Expected: PASS。

- [ ] **Step 6: 提交环境一致性配置**

```powershell
git add apps/miniapp/scripts infra/deploy/compose.production.yml infra/deploy/production.env.example
git commit -m "fix: align miniapp recharge release modes"
```

### Task 4: 文档、全量验证、体验构建与测试 API 部署

**Files:**
- Modify: `apps/miniapp/README.md`
- Modify: `docs/0.23.0会员小程序与交易记录验收.md`
- Modify: `docs/正式需求基线-v2-PC优先.md`（主工作区权威文档存在时同步）

**Interfaces:**
- Consumes: 统一充值页面、订单接口和部署配置。
- Produces: 可供账号所有者上传的 `production-test-wechat` 构建。

- [ ] **Step 1: 更新正式需求和小程序说明**

明确记录：

- 快捷充值为 100、300、500、1000 元；
- 自定义金额最低 0.01 元、最多两位小数；
- 体验与正式页面和支付链路一致；
- 不再使用固定 0.01 元测试模式；
- 正式支付启用前不会改动当前生产容器。

- [ ] **Step 2: 运行完整验证**

Run:

```powershell
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
git diff --check
```

Expected: 退出码均为 0。

- [ ] **Step 3: 验证正式配置并构建体验版**

正式门店 ID 尚未配置，因此通过构建配置自动测试验证
`production-wechat`；不得生成带测试门店 ID 的伪正式包。使用本机忽略配置生成
体验版：

```powershell
$env:ZYAPP_MINIAPP_MODE='production-test-wechat'
corepack pnpm miniapp:build
```

Expected: 构建配置测试证明正式版启用真实支付且固定生产 API；最终 `dist` 为
只含会员三页、启用真实支付的 `production-test-wechat`。生产门店配置完成后再生成
真正的 `production-wechat` 包。

- [ ] **Step 4: 只部署测试 API**

运行 `infra/scripts/deploy-miniapp-production-test.ps1`，使用本机已有密钥路径。
脚本必须备份测试库、迁移测试库、只重建 `api-test`，并确认生产 `api` 和
Caddy 容器 ID 没有变化。

- [ ] **Step 5: 执行公网烟测**

```powershell
curl.exe --fail https://judian.icu/v1/health/ready
curl.exe --fail https://judian.icu/test/v1/health/ready
curl.exe --silent --output NUL --write-out "%{http_code}" `
  https://judian.icu/test/v1/member/recharge/config
```

Expected: 两个健康检查为 200；无会话充值配置请求为 401，不是 404/503。

- [ ] **Step 6: 记录验证并提交文档**

```powershell
git add apps/miniapp/README.md
git add -f docs/0.23.0会员小程序与交易记录验收.md
git commit -m "docs: record unified miniapp recharge validation"
```

- [ ] **Step 7: 保留分支等待体验验收**

Run:

```powershell
git status --short
git log --oneline -8
git ls-remote --heads origin codex/member-recharge-pc-transactions
```

Expected: 工作区干净，当前分支只保留本地提交，远端仍没有该分支；不合并、不推送。
