# 小程序已有会员资料分流与头像上传修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 已有会员绑定微信后直接使用数据库资料进入会员首页，新会员才进入昵称必填、头像选填的注册页，并保留后续自助修改头像能力。

**Architecture:** 后端继续以 `MemberSelfServiceSummary.profileCompleted` 作为稳定客户端契约，但在“未绑定身份按手机号命中已有会员”这一事务分支中把历史错误的未完成状态修正为完成，并追加事件与审计。小程序所有登录方式统一使用后端返回值分流；资料保存由独立服务协调“上传头像”和“用户确认后改用默认头像”两条路径。

**Tech Stack:** TypeScript 5.9、NestJS 11、PostgreSQL、原生微信小程序、Vitest 4、pnpm 10.12.1

## Global Constraints

- 目标工作树固定为 `E:\AIproject\zyApp\.worktrees\member-recharge-pc-transactions`。
- 不合并分支，不修改 `main`，不改动主工作树未跟踪的部署环境备份。
- 已有活跃会员按手机号绑定时不得覆盖昵称、头像、等级、余额、月卡、生日或年龄资格。
- 新会员昵称必填且为 2–12 个 Unicode 字符，头像选填。
- 金额继续使用整数分；本任务不改动钱包、月卡、订单、充值或支付规则。
- 会员状态修正、领域事件和审计必须在同一 PostgreSQL 事务中提交。
- 微信合法域名使用根地址 `https://judian.icu`，不包含 `/test`。
- 测试 API 必须先于依赖新增接口的体验版发布；生产 API 不在本计划部署范围。

---

## File Structure

- `apps/api/src/member-self-service.service.ts`：在已有会员手机号绑定事务中修正资料完成状态。
- `apps/api/src/member-self-service.service.test.ts`：覆盖短信回退和微信一键登录绑定已有会员的服务行为。
- `apps/miniapp/src/services/member-login.ts`：提供统一的新会员资料分流判断。
- `apps/miniapp/src/services/member-login.test.ts`：覆盖完成/未完成会员的分流判断。
- `apps/miniapp/src/services/member-profile.ts`：协调昵称保存、头像上传和经用户确认后的默认头像降级。
- `apps/miniapp/src/services/member-profile.test.ts`：覆盖头像选填与失败降级，不测试 mock 自身。
- `apps/miniapp/src/services/http-client.ts`：将微信合法域名上传错误转换为可读中文错误。
- `apps/miniapp/src/services/http-client.test.ts`：覆盖真实 `wx.uploadFile` 失败边界。
- `apps/miniapp/src/pages/home/index.ts`：所有会员登录方式按后端结果统一分流。
- `apps/miniapp/src/pages/member/index.ts`：调用资料保存协调器并展示默认头像确认框。
- `apps/miniapp/src/pages/member/index.wxml`：明确头像选填和后续可修改。
- `apps/miniapp/package.json`：将新增资料保存测试加入小程序测试命令。
- `apps/miniapp/README.md`：补充合法域名错误排查和刷新步骤。
- `docs/0.23.0会员小程序与交易记录验收.md`：加入新旧会员分流与头像选填人工验收项。
- `infra/scripts/deploy-miniapp-production-test.ps1`：复用现有备份、迁移、测试 API 重建和健康检查流程，不修改脚本内容。

### Task 1: 后端权威区分已有会员与新会员

**Files:**
- Modify: `apps/api/src/member-self-service.service.test.ts`
- Modify: `apps/api/src/member-self-service.service.ts`

**Interfaces:**
- Consumes: `MemberProjectionRow`、`MiniappPrincipal`、当前事务 `PoolClient`。
- Produces: `completeExistingMemberProfile(client, principal, before): Promise<void>`；现有 `MemberSelfServiceSummary` 结构不变。

- [ ] **Step 1: 写入短信回退绑定已有会员的失败测试**

把现有 “binds an existing phone member without overwriting the old profile”
夹具补全为真实 `MemberProjectionRow`，显式设置：

```ts
{
  id: memberId,
  member_number: 'M5555555555',
  phone: '13800138000',
  nickname: '旧系统昵称',
  avatar_url: null,
  profile_completed: false,
  tier: 'advanced',
  status: 'active',
  birthday_month: 2,
  birthday_day: 29,
  birthday_source: 'legacy',
  note: '旧会员',
  source: 'legacy',
  age_gate_status: 'confirmed_at_least_14',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z'
}
```

让事件插入返回 `{ sequence: 701 }`，摘要查询返回原昵称、空头像和
`profile_completed: true`。新增断言：

```ts
expect(result).toMatchObject({
  memberId,
  nickname: '旧系统昵称',
  avatarUrl: null,
  profileCompleted: true,
  tier: 'advanced',
  ageGate: 'confirmed_at_least_14'
})
expect(calls.some((call) =>
  call.sql.includes('profile_completed = TRUE')
)).toBe(true)
expect(calls.some((call) =>
  call.sql.includes("'member.profile_completion_reconciled'")
)).toBe(true)
expect(calls.some((call) =>
  call.sql.includes('INSERT INTO cloud_audit_log')
)).toBe(true)
expect(calls.some((call) =>
  call.sql.includes('INSERT INTO cloud_member')
)).toBe(false)
```

- [ ] **Step 2: 运行测试并确认因缺少状态修正而失败**

Run:

```powershell
corepack pnpm vitest run apps/api/src/member-self-service.service.test.ts -t "binds an existing phone member"
```

Expected: FAIL；未出现 `profile_completed = TRUE` 或资料完成事件。

- [ ] **Step 3: 写入微信一键登录绑定已有会员的失败测试**

新增一例未绑定的微信身份，手机号查询命中
`profile_completed: false` 的活跃旧会员。输入仍使用占位昵称：

```ts
it('WeChat login binds an existing member without requiring profile completion', async () => {
  const memberId = '55555555-5555-4555-8555-555555555555'
  const cfg = config()
  const existing = {
    id: memberId,
    member_number: 'M5555555555',
    phone: '13800138000',
    nickname: '旧系统昵称',
    avatar_url: null,
    profile_completed: false,
    tier: 'advanced',
    status: 'active',
    birthday_month: 2,
    birthday_day: 29,
    birthday_source: 'legacy',
    note: '旧会员',
    source: 'legacy',
    age_gate_status: 'confirmed_at_least_14',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z'
  } as const
  const { pool, calls } = fakePool((sql) => {
    if (sql.includes('FROM miniapp_identity')) {
      return [{ member_id: null, status: 'active' }]
    }
    if (sql.includes('INSERT INTO api_idempotency')) {
      return [{ key: 'reserved' }]
    }
    if (sql.includes('FROM cloud_member') && sql.includes('phone = $2')) {
      return [existing]
    }
    if (sql.includes('INSERT INTO cloud_event')) {
      return [{ sequence: 702 }]
    }
    if (sql.includes('LEFT JOIN cloud_wallet_account')) {
      return [{
        id: memberId,
        phone: existing.phone,
        nickname: existing.nickname,
        avatar_url: null,
        profile_completed: true,
        tier: existing.tier,
        birthday_month: existing.birthday_month,
        birthday_day: existing.birthday_day,
        age_gate_status: existing.age_gate_status,
        principal_balance_fen: 50_000,
        gift_balance_fen: 5_000,
        monthly_card_status: null,
        monthly_card_expires_at: null
      }]
    }
    return []
  })
  const service = new MemberSelfService(pool, fakeRedis(), cfg)

  const result = await service.loginWithWechatProfile(principal(), {
  requestId: 'wechat-existing-member-1',
  phoneCode: 'mock-phone:13800138000',
  nickname: '微信用户',
  avatarUrl: null,
  confirmedAtLeast14: true
  })

  expect(result).toMatchObject({
    memberId,
    nickname: '旧系统昵称',
    avatarUrl: null,
    profileCompleted: true,
    tier: 'advanced'
  })
  expect(calls.some((call) =>
    call.sql.includes('INSERT INTO cloud_member')
  )).toBe(false)
  expect(calls.some((call) =>
    call.sql.includes('SET nickname =')
  )).toBe(false)
})
```

- [ ] **Step 4: 运行新测试并确认因缺少统一修正而失败**

Run:

```powershell
corepack pnpm vitest run apps/api/src/member-self-service.service.test.ts -t "WeChat login binds an existing"
```

Expected: FAIL；已有微信登录分支没有修正资料完成状态。

- [ ] **Step 5: 实现最小后端状态修正**

在 `MemberSelfService` 中增加：

```ts
private async completeExistingMemberProfile(
  client: PoolClient,
  principal: MiniappPrincipal,
  before: MemberProjectionRow
): Promise<void> {
  if (before.profile_completed) return
  const timestamp = new Date().toISOString()
  const after = this.memberSnapshot(before, {
    profileCompleted: true,
    updatedAt: timestamp
  })
  const event = await client.query<{ sequence: number | string }>(
    `INSERT INTO cloud_event
     (event_id, tenant_id, store_id, aggregate_type, aggregate_id,
      event_type, payload_json, occurred_at)
     VALUES ($1, $2, $3, 'member', $4,
             'member.profile_completion_reconciled', $5::jsonb, $6)
     RETURNING sequence`,
    [
      randomUUID(),
      principal.tenantId,
      principal.storeId,
      before.id,
      JSON.stringify({
        action: 'member.profile_completion_reconciled',
        memberId: before.id,
        before: this.memberSnapshot(before),
        after,
        reason: 'existing member bound to miniapp'
      }),
      timestamp
    ]
  )
  const serverVersion = Number(event.rows[0]?.sequence)
  if (!Number.isSafeInteger(serverVersion) || serverVersion < 1) {
    throw new Error('Cloud event did not return a valid sequence')
  }
  await client.query(
    `UPDATE cloud_member
     SET profile_completed = TRUE, server_version = $3, updated_at = $4
     WHERE tenant_id = $1 AND id = $2`,
    [principal.tenantId, before.id, serverVersion, timestamp]
  )
  await client.query(
    `INSERT INTO cloud_audit_log
     (id, tenant_id, store_id, actor_id, action, aggregate_type,
      aggregate_id, metadata_json, occurred_at)
     VALUES ($1, $2, $3, NULL,
             'member.profile_completion_reconciled', 'member',
             $4, $5::jsonb, $6)`,
    [
      randomUUID(),
      principal.tenantId,
      principal.storeId,
      before.id,
      JSON.stringify({
        identityId: principal.identityId,
        source: 'existing_member_binding'
      }),
      timestamp
    ]
  )
}
```

在短信注册与微信一键登录的“手机号命中活跃会员”分支调用该方法；新会员创建分支
保持 `profileCompleted=false`。已经绑定且未完成的新会员不调用该方法。

- [ ] **Step 6: 运行 API 定向测试并确认通过**

Run:

```powershell
corepack pnpm vitest run apps/api/src/member-self-service.test.ts apps/api/src/member-self-service.service.test.ts apps/api/src/member-self-service.controller.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交后端修复**

```powershell
git add apps/api/src/member-self-service.service.ts apps/api/src/member-self-service.service.test.ts
git commit -m "fix: preserve existing miniapp member profiles"
```

### Task 2: 统一所有登录方式的新旧会员页面分流

**Files:**
- Modify: `apps/miniapp/src/services/member-login.test.ts`
- Modify: `apps/miniapp/src/services/member-login.ts`
- Modify: `apps/miniapp/src/pages/home/index.ts`

**Interfaces:**
- Consumes: `Pick<MemberSelfServiceSummary, 'profileCompleted'>`。
- Produces: `needsMemberProfileCompletion(member): boolean`。

- [ ] **Step 1: 写入资料分流失败测试**

在 `member-login.test.ts` 增加：

```ts
it('requires profile completion only for incomplete new members', () => {
  expect(needsMemberProfileCompletion({ profileCompleted: false })).toBe(true)
  expect(needsMemberProfileCompletion({ profileCompleted: true })).toBe(false)
})
```

- [ ] **Step 2: 运行测试并确认导出不存在**

Run:

```powershell
corepack pnpm vitest run apps/miniapp/src/services/member-login.test.ts
```

Expected: FAIL；`needsMemberProfileCompletion` 尚未导出。

- [ ] **Step 3: 实现分流函数并替换重复判断**

在 `member-login.ts` 增加：

```ts
import type {
  MemberSelfServiceSummary,
  PhoneVerificationChallenge
} from '@zyapp/contracts'

export function needsMemberProfileCompletion(
  member: Pick<MemberSelfServiceSummary, 'profileCompleted'>
): boolean {
  return !member.profileCompleted
}
```

在 `home/index.ts` 的初始加载、微信手机号登录和短信验证码登录中统一调用该函数。
短信回退必须保存后端结果：

```ts
const member = await getMiniappClient().registerMember({
  requestId: requestId('member-register'),
  challengeId: this.data.loginChallengeId,
  verificationCode: code,
  phone,
  nickname: '微信用户',
  confirmedAtLeast14: defaultConfirmedAtLeast14
})
if (needsMemberProfileCompletion(member)) {
  wx.reLaunch({ url: '/pages/member/index?mode=complete' })
  return
}
await this.load()
wx.showToast({ title: '登录成功', icon: 'success' })
```

- [ ] **Step 4: 运行分流测试和类型检查**

Run:

```powershell
corepack pnpm vitest run apps/miniapp/src/services/member-login.test.ts
corepack pnpm miniapp:typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交客户端分流修复**

```powershell
git add apps/miniapp/src/services/member-login.ts apps/miniapp/src/services/member-login.test.ts apps/miniapp/src/pages/home/index.ts
git commit -m "fix: route existing miniapp members home"
```

### Task 3: 头像选填、上传错误翻译和默认头像继续

**Files:**
- Create: `apps/miniapp/src/services/member-profile.ts`
- Create: `apps/miniapp/src/services/member-profile.test.ts`
- Modify: `apps/miniapp/src/services/http-client.test.ts`
- Modify: `apps/miniapp/src/services/http-client.ts`
- Modify: `apps/miniapp/src/pages/member/index.ts`
- Modify: `apps/miniapp/src/pages/member/index.wxml`
- Modify: `apps/miniapp/package.json`

**Interfaces:**
- Consumes: `Pick<MiniappClient, 'updateMemberProfile' | 'updateMemberProfileWithAvatar'>`。
- Produces:
  - `saveOptionalAvatarProfile(client, nickname, localAvatarPath, confirmDefaultAvatar): Promise<MemberSelfServiceSummary>`
  - `avatarUploadError(error): Error`

- [ ] **Step 1: 写入头像选填与确认降级失败测试**

创建 `member-profile.test.ts`，使用有状态的轻量 fake，断言真实返回分支：

```ts
import type { MemberSelfServiceSummary } from '@zyapp/contracts'
import { describe, expect, it } from 'vitest'
import { saveOptionalAvatarProfile } from './member-profile'

function memberSummary(
  nickname: string,
  avatarUrl: string | null
): MemberSelfServiceSummary {
  return {
    memberId: 'member-1',
    nickname,
    avatarUrl,
    profileCompleted: true,
    phoneMasked: '138****8000',
    tier: 'ordinary',
    principalBalanceFen: 0,
    giftBalanceFen: 0,
    monthlyCardStatus: 'none',
    monthlyCardExpiresAt: null,
    birthdayMonth: null,
    birthdayDay: null,
    birthdayCanBeFilled: true,
    ageGate: 'confirmed_at_least_14'
  }
}

it('saves a required nickname without an avatar', async () => {
  const calls: string[] = []
  const result = await saveOptionalAvatarProfile(
    {
      updateMemberProfile: async (nickname) => {
        calls.push(`nickname:${nickname}`)
        return memberSummary(nickname, null)
      },
      updateMemberProfileWithAvatar: async () => {
        throw new Error('unexpected upload')
      }
    },
    '林小满',
    '',
    async () => false
  )
  expect(result.avatarUrl).toBeNull()
  expect(calls).toEqual(['nickname:林小满'])
})

it('uses the default avatar only after upload failure is confirmed', async () => {
  const calls: string[] = []
  const result = await saveOptionalAvatarProfile(
    {
      updateMemberProfileWithAvatar: async () => {
        calls.push('upload')
        throw new Error('头像上传域名尚未生效')
      },
      updateMemberProfile: async (nickname) => {
        calls.push('default')
        return memberSummary(nickname, null)
      }
    },
    '林小满',
    'wxfile://avatar',
    async () => true
  )
  expect(result.avatarUrl).toBeNull()
  expect(calls).toEqual(['upload', 'default'])
})
```

加入用户拒绝使用默认头像的测试：

```ts
it('keeps the upload failure when default avatar fallback is declined', async () => {
  const uploadError = new Error('头像上传失败')
  let nicknameSaved = false
  await expect(
    saveOptionalAvatarProfile(
      {
        updateMemberProfileWithAvatar: async () => {
          throw uploadError
        },
        updateMemberProfile: async (nickname) => {
          nicknameSaved = true
          return memberSummary(nickname, null)
        }
      },
      '林小满',
      'wxfile://avatar',
      async () => false
    )
  ).rejects.toBe(uploadError)
  expect(nicknameSaved).toBe(false)
})
```

- [ ] **Step 2: 运行新增测试并确认模块不存在**

Run:

```powershell
corepack pnpm vitest run apps/miniapp/src/services/member-profile.test.ts
```

Expected: FAIL；`member-profile.ts` 尚不存在。

- [ ] **Step 3: 实现资料保存协调器**

创建 `member-profile.ts`：

```ts
import type { MemberSelfServiceSummary } from '@zyapp/contracts'
import type { MiniappClient } from './types'

export async function saveOptionalAvatarProfile(
  client: Pick<
    MiniappClient,
    'updateMemberProfile' | 'updateMemberProfileWithAvatar'
  >,
  nickname: string,
  localAvatarPath: string,
  confirmDefaultAvatar: (error: Error) => Promise<boolean>
): Promise<MemberSelfServiceSummary> {
  if (!localAvatarPath) return client.updateMemberProfile(nickname)
  try {
    return await client.updateMemberProfileWithAvatar(
      nickname,
      localAvatarPath
    )
  } catch (cause) {
    const error =
      cause instanceof Error ? cause : new Error('头像上传失败')
    if (!(await confirmDefaultAvatar(error))) throw error
    return client.updateMemberProfile(nickname)
  }
}
```

- [ ] **Step 4: 写入合法域名错误翻译失败测试**

在 `http-client.test.ts` 安装会调用 `options.fail` 的 `wx.uploadFile`：

```ts
options.fail?.({
  errMsg: 'uploadFile:fail url not in domain list'
} as WechatMiniprogram.GeneralCallbackResult)
```

断言：

```ts
await expect(
  client.updateMemberProfileWithAvatar('林小满', 'wxfile://avatar')
).rejects.toThrow('头像上传域名尚未生效')
```

- [ ] **Step 5: 运行测试并确认仍暴露原始英文错误**

Run:

```powershell
corepack pnpm vitest run apps/miniapp/src/services/http-client.test.ts -t "upload domain"
```

Expected: FAIL；错误仍为 `uploadFile:fail url not in domain list`。

- [ ] **Step 6: 实现最小错误翻译**

在 `http-client.ts` 增加：

```ts
function avatarUploadError(message: string): Error {
  return message.includes('url not in domain list')
    ? new Error('头像上传域名尚未生效，请稍后重试或使用默认头像')
    : new Error(message || '头像上传失败')
}
```

`wx.uploadFile.fail` 改为 `reject(avatarUploadError(error.errMsg))`。

- [ ] **Step 7: 接入注册页确认流程**

`member/index.ts` 使用 `saveOptionalAvatarProfile`。首次完善模式的确认回调通过
Promise 包装 `wx.showModal`：

```ts
const confirmDefaultAvatar = (error: Error) =>
  new Promise<boolean>((resolve) => {
    if (this.data.mode !== 'complete') {
      resolve(false)
      return
    }
    wx.showModal({
      title: '头像暂未上传',
      content: `${error.message}。是否先使用默认头像完成注册？`,
      confirmText: '继续注册',
      cancelText: '返回重试',
      success: (result) => resolve(result.confirm),
      fail: () => resolve(false)
    })
  })
```

保存成功后保持现有跳转。编辑模式失败时不得降级保存昵称。

`member/index.wxml` 将头像提示改为：

```xml
<text class="muted avatar-tip">头像选填，之后可在「我的资料」中修改</text>
```

- [ ] **Step 8: 把新增测试加入小程序测试命令并运行**

在 `apps/miniapp/package.json` 的 Vitest 文件列表中加入
`apps/miniapp/src/services/member-profile.test.ts`。

Run:

```powershell
corepack pnpm vitest run apps/miniapp/src/services/member-profile.test.ts apps/miniapp/src/services/http-client.test.ts
corepack pnpm miniapp:typecheck
```

Expected: PASS。

- [ ] **Step 9: 提交头像选填修复**

```powershell
git add apps/miniapp/src/services/member-profile.ts apps/miniapp/src/services/member-profile.test.ts apps/miniapp/src/services/http-client.ts apps/miniapp/src/services/http-client.test.ts apps/miniapp/src/pages/member/index.ts apps/miniapp/src/pages/member/index.wxml apps/miniapp/package.json
git commit -m "fix: allow default avatar during member signup"
```

### Task 4: 生产/体验构建隔离、文档与全量验证

**Files:**
- Modify: `apps/miniapp/scripts/build-configuration.mjs`
- Modify: `apps/miniapp/scripts/build-configuration.test.mjs`
- Create: `apps/miniapp/src/services/member-home.ts`
- Create: `apps/miniapp/src/services/member-home.test.ts`
- Modify: `apps/miniapp/src/pages/home/index.ts`
- Modify: `apps/miniapp/src/pages/home/index.wxml`
- Modify: `config/public-endpoints.example.json`
- Modify: `infra/scripts/deploy-miniapp-production-test.ps1`
- Modify: `apps/miniapp/README.md`
- Modify: `docs/0.23.0会员小程序与交易记录验收.md`

**Interfaces:**
- Consumes: 已实现的新旧会员分流、头像选填和合法域名错误处理。
- Produces: 可由账号所有者执行的发布与真机验收步骤。

- [ ] **Step 0: 锁定正式版与体验版环境**

新增 `production-wechat` 模式并固定到 `https://judian.icu`；继续把
`production-test-wechat` 固定到 `https://judian.icu/test`。正式支付尚未启用时，
首页不得请求充值配置或显示充值入口。测试部署脚本只重建 `api-test`，并在部署前后
核对生产 `api` 和 Caddy 容器 ID。

- [ ] **Step 1: 更新合法域名排查说明**

在 README 现有服务器域名清单后补充：

```text
若出现 uploadFile:fail url not in domain list，确认配置的是
uploadFile 合法域名而不只是 request 合法域名；保存后重新编译并重启
开发者工具或体验版。注册时可先不选头像，使用默认头像完成。
```

- [ ] **Step 2: 更新 0.23.0 人工验收清单**

增加以下独立验收项：

1. 测试库已有手机号首次绑定后直接进入首页，显示数据库昵称与默认头像。
2. 测试库不存在的手机号进入资料完善页，只填昵称即可完成。
3. 已有会员从“我的资料”上传头像，退出重进后仍显示持久头像。
4. 编辑模式上传失败时不得提示保存成功。

- [ ] **Step 3: 运行 API 与小程序定向测试**

Run:

```powershell
corepack pnpm vitest run apps/api/src/member-self-service.test.ts apps/api/src/member-self-service.service.test.ts apps/api/src/member-self-service.controller.test.ts
corepack pnpm miniapp:test
```

Expected: PASS，无未处理异常或警告。

- [ ] **Step 4: 运行类型检查与 Mock 构建**

Run:

```powershell
corepack pnpm --filter @zyapp/api typecheck
corepack pnpm miniapp:typecheck
$env:ZYAPP_MINIAPP_MODE='mock'
corepack pnpm miniapp:build
```

Expected: PASS；最终交付给体验者时，`apps/miniapp/dist` 为
`production-test-wechat` 构建。

- [ ] **Step 5: 检查改动范围**

Run:

```powershell
git diff --check
git status --short
git diff --stat 6e71475..HEAD
```

Expected: 只有本计划列出的 API、小程序、测试和文档文件。

- [ ] **Step 6: 提交文档与验收清单**

```powershell
git add apps/miniapp/README.md
git add -f docs/0.23.0会员小程序与交易记录验收.md
git commit -m "docs: add miniapp profile routing acceptance"
```

- [ ] **Step 7: 使用完成前验证技能复核结果**

调用 `superpowers:verification-before-completion`，重新读取最后一次测试、类型检查和构建输出；不得把 Mock 或模拟器结果描述为真实微信登录、合法域名或真机验收通过。

### Task 5: 经授权后发布隔离测试 API 并做路由烟测

**Files:**
- No source changes.

**Interfaces:**
- Consumes: `infra/scripts/deploy-miniapp-production-test.ps1` 及本机已有、未纳入 Git 的 SSH 与微信支付密钥文件。
- Produces: 运行当前分支代码和迁移的 `https://judian.icu/test` API；不改动生产 API。

- [ ] **Step 1: 取得用户对测试环境部署的明确授权**

部署会备份测试数据库、构建并迁移 `api-test`，然后重建测试 API 容器。未收到明确授权时停止在本步骤，不读取或输出密钥内容。

- [ ] **Step 2: 部署前记录线上不兼容证据**

Run:

```powershell
curl.exe --silent --output NUL --write-out "%{http_code}" `
  --request POST --header "Content-Type: application/json" --data "{}" `
  https://judian.icu/test/v1/member/profile
curl.exe --silent --output NUL --write-out "%{http_code}" `
  --request POST --header "Content-Type: application/json" --data "{}" `
  https://judian.icu/test/v1/member/profile-with-avatar
```

Expected before deployment: both return `404`。

- [ ] **Step 3: 使用现有安全包装脚本发布测试 API**

从本机既有配置中传入文件路径，不在命令输出、日志或文档中打印文件内容：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File infra/scripts/deploy-miniapp-production-test.ps1 `
  -HostName 124.220.69.209 `
  -KeyPath E:\AIproject\zyApp\.tmp\ssh\kaifa_PC.pem `
  -EnvironmentPath E:\AIproject\zyApp\infra\deploy\production.env `
  -ApiV3KeyPath E:\证书\API证书\apiv3.key `
  -MerchantCertificatePath E:\证书\API证书\apiclient_cert.pem `
  -MerchantPrivateKeyPath E:\证书\API证书\apiclient_key.pem `
  -WechatPayPublicKeyPath E:\证书\API证书\pub_key.pem
```

Expected: 测试库备份成功，迁移成功，仅重建 `api-test`；生产 `api` 与
Caddy 容器 ID 保持不变。

- [ ] **Step 4: 验证健康状态与资料路由已部署**

Run:

```powershell
curl.exe --fail --silent --show-error `
  https://judian.icu/test/v1/health/ready
curl.exe --silent --output NUL --write-out "%{http_code}" `
  --request POST --header "Content-Type: application/json" --data "{}" `
  https://judian.icu/test/v1/member/profile
curl.exe --silent --output NUL --write-out "%{http_code}" `
  --request POST --header "Content-Type: application/json" --data "{}" `
  https://judian.icu/test/v1/member/profile-with-avatar
```

Expected: 健康检查返回 `status: ok`；两个无会话 POST 请求均返回 `401`，不再是 `404 Cannot POST`。

- [ ] **Step 5: 交给账号所有者重新上传体验版并做真机验收**

只有路由烟测通过后才重新构建和上传体验版。真实手机号授权、已有会员直达、新会员昵称注册、头像上传和重进头像显示由账号所有者在真机完成。
