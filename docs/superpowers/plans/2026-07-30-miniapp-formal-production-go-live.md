# 小程序正式环境完整投产实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ZyApp 0.23.2 的正式小程序与匹配的生产 API 完整投入使用，修复头像上传路由、启用真实微信支付，并以自动门禁保证测试库数据绝不进入生产库。

**Architecture:** 保持 `production-wechat → https://judian.icu → 正式 PostgreSQL/Redis/头像卷/支付回调` 的单向正式链路。扩充现有生产部署脚本，使支付启用必须显式授权，生产和测试数据库身份必须不同，正式发布不得启动测试迁移或重建测试 API，并在发布后验证头像路由、支付配置、测试容器和测试迁移均符合隔离要求。

**Tech Stack:** PowerShell 7/Windows PowerShell、Bash、Docker Compose、NestJS、PostgreSQL 17、微信小程序原生 TypeScript、pnpm 10.12.1。

## Global Constraints

- 候选版本固定为 0.23.2。
- 正式小程序 API 固定为 `https://judian.icu`，正式门店固定为 `7755df34-4309-43ed-8800-c0dc2049bb17`。
- 测试库中的会员、钱包、月卡、订单、支付、头像和历史数据不得复制、导入、合并、回填或重放到生产库。
- 正式数据库只执行仓库迁移；当前最新迁移必须为 18。
- 正式支付回调固定为 `https://judian.icu/v1/payments/wechat/recharge/notify`，订单前缀固定为 `ZYP-`。
- 不读取、修改、暂存或提交 `infra/deploy/production.env.before-domain-20260725`。
- 密钥内容不得进入源码、日志、聊天、截图或发布记录。
- 微信体验版上传、真实头像、真实手机号、真实付款、商户平台对账、审核和最终发布由账号负责人完成。

---

### Task 1: 加固正式部署脚本的支付与数据库隔离门禁

**Files:**
- Modify: `.dockerignore`
- Modify: `infra/scripts/deploy-miniapp-production.ps1`
- Test: live preflight and route probes defined below

**Interfaces:**
- Consumes: `-HostName`, `-KeyPath`, `-ExpectedCommit`, `-RemoteDirectory`, `-ValidateOnly`, `-PreflightOnly`。
- Produces: 新增 `-EnableProductionPayment` 显式开关；发布输出包含生产备份、迁移、头像路由、支付环境和测试隔离证据。

- [x] **Step 1: 保存当前失败证据**

Run:

```powershell
ssh -i E:\AIproject\zyApp\.tmp\ssh\kaifa_PC.pem `
  ubuntu@124.220.69.209 `
  "curl --silent --output /dev/null --write-out '%{http_code}' --request POST https://judian.icu/v1/member/profile-with-avatar"
```

Expected: `404`。

- [x] **Step 2: 在参数层增加显式支付授权**

在 `deploy-miniapp-production.ps1` 的 `param` 中加入：

```powershell
[switch]$EnableProductionPayment
```

不传该开关时，脚本不得把关闭的生产支付改为 `wechat`；传入开关时，只有 AppID/AppSecret、商户号、证书序列号、公钥标识和三份只读密钥文件均存在，才允许继续。

- [x] **Step 3: 将远端预检拆成只读资格检查**

预检必须输出非敏感结果并检查：

```text
FORMAL_STORE=<tenant>|<store>|<name>|active
GIFT_TIER=<principalFen>|<giftFen>
PRODUCTION_PAYMENT_CHANGE=required|not-required
PRODUCTION_DATABASE=zyapp
TEST_DATABASE=zyapp_test
```

数据库名称必须不同；`migrate` 服务必须与生产 API 使用同一个正式数据库；不得输出数据库 URL。

- [x] **Step 4: 在数据库备份后启用正式支付**

远端部署脚本先生成并验证生产数据库备份，再备份现有 `production.env`，然后仅在 `-EnableProductionPayment` 存在时幂等写入：

```dotenv
PRODUCTION_WECHAT_PAYMENT_MODE=wechat
```

不得修改 `TEST_WECHAT_PAYMENT_MODE` 或其他测试配置。

- [x] **Step 5: 固定测试环境不变门禁**

发布前记录：

```text
api-test container ID
test database name
test cloud_schema_migration max version
```

发布命令只允许：

```bash
docker compose build --no-cache migrate api
docker compose run --rm --no-deps migrate
docker compose up -d --no-deps --force-recreate api caddy
```

发布后逐项比较测试 API 容器 ID、测试数据库名称、测试迁移版本和测试支付金额配置；任一变化即失败。测试环境可以保留其原有的小额支付测试配置，但正式发布不得清空或改写。脚本中不得调用 `migrate-test`、重建 `api-test` 或执行测试库迁移/数据导入。

生产环境备份必须保存到 Docker 构建上下文以外的 root-only 目录；`.dockerignore` 必须排除 `infra/deploy/*.env*`。生产与测试 API 的数据库完整身份必须分别精确为 `postgres:5432/zyapp` 和 `postgres:5432/zyapp_test`，确保容器内核验及备份针对实际 API 数据库。发布必须由 `git archive` 从显式 `-ExpectedCommit` 生成，且 tracked worktree 必须干净；镜像在独立候选目录中构建，随后使用 `--no-build` 启动，避免服务器旧源码残留进入运行产物。构建前必须给旧 API 镜像增加专用回滚标签，防止重建期间镜像被回收；发布后门禁必须输出明确失败原因。发布失败时恢复旧环境文件和旧 API 镜像，但不自动恢复数据库。

服务器对短时间连续新建 SSH 会话限流时，只读预检、文件上传和临时目录清理可使用 keepalive 与有上限的退避重试；真正执行生产变更的远程部署命令不得自动重试，避免连接中断时重复执行发布。

- [x] **Step 6: 增加头像路由与支付验证**

健康循环中增加：

```bash
profile_status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --request POST https://judian.icu/v1/member/profile)
avatar_status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --request POST https://judian.icu/v1/member/profile-with-avatar)
```

两个状态都必须为 `401`；`404` 必须使发布失败。容器内还必须验证：

```text
DEPLOYMENT_ENVIRONMENT=production
WECHAT_PAYMENT_MODE=wechat
WECHAT_PAY_NOTIFY_URL=https://judian.icu/v1/payments/wechat/recharge/notify
WECHAT_PAY_OUT_TRADE_NO_PREFIX=ZYP-
WECHAT_PAYMENT_TEST_AMOUNT_FEN is absent
```

- [x] **Step 7: 执行静态与自动测试**

Run:

```powershell
$errors = $null
[Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path 'infra/scripts/deploy-miniapp-production.ps1'),
  [ref]$null,
  [ref]$errors
) | Out-Null
if ($errors.Count -gt 0) { throw ($errors | Out-String) }
corepack pnpm test
git diff --check
```

Expected: PowerShell 无解析错误；96 个测试文件、415 项测试或更多全部通过；`git diff --check` 无输出。

### Task 2: 生成并验证最终正式小程序产物

**Files:**
- Generated: `apps/miniapp/dist/**`

**Interfaces:**
- Consumes: `config/public-endpoints.local.json` 中的正式 API、正式门店和 AppID。
- Produces: `production-wechat` 顾客正式构建。

- [x] **Step 1: 运行小程序测试和类型检查**

Run:

```powershell
corepack pnpm miniapp:typecheck
corepack pnpm miniapp:test
```

Expected: 全部通过。

- [x] **Step 2: 构建正式产物**

Run:

```powershell
$env:ZYAPP_MINIAPP_MODE='production-wechat'
$env:ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED='false'
corepack pnpm miniapp:build
```

Expected: `[miniapp] built production-wechat mode`。

- [x] **Step 3: 检查产物隔离**

Run:

```powershell
rg -n "apiBaseUrl|storeId|useMock|authMode|customerOnly|realWechatPayment" `
  apps/miniapp/dist/services/client.js
rg -n "judian\.icu/test|18888888888" `
  apps/miniapp/dist/services/client.js apps/miniapp/dist/app.json
```

Expected: 正式配置为 `https://judian.icu`、正式门店、`useMock:false`、`authMode:"wechat"`、`customerOnly:true`、`realWechatPayment:true`；第二条搜索无测试运行时配置命中。Source map 和未选择的客户端实现可以保留调试源码文本，但生产 API 必须继续拒绝开发会话、Mock 支付和虚拟手机号。

### Task 3: 执行生产预检、备份与发布

**Files:**
- Execute: `infra/scripts/deploy-miniapp-production.ps1`

**Interfaces:**
- Consumes: 当前提交、服务器 SSH 密钥、远端正式环境和只读支付密钥。
- Produces: 新正式 API 容器、已启用的正式支付、已校验生产备份。

- [x] **Step 1: 运行完整只读预检**

Run:

```powershell
$candidateCommit = (git rev-parse HEAD).Trim()
powershell -NoProfile -ExecutionPolicy Bypass `
  -File infra/scripts/deploy-miniapp-production.ps1 `
  -HostName 124.220.69.209 `
  -KeyPath E:\AIproject\zyApp\.tmp\ssh\kaifa_PC.pem `
  -ExpectedCommit $candidateCommit `
  -EnableProductionPayment `
  -PreflightOnly
```

Expected: 正式门店唯一、充赠规则存在、生产/测试数据库不同、双健康正常，支付变更显示 `required` 或 `not-required`。

- [x] **Step 2: 执行正式发布**

Run:

```powershell
$candidateCommit = (git rev-parse HEAD).Trim()
powershell -NoProfile -ExecutionPolicy Bypass `
  -File infra/scripts/deploy-miniapp-production.ps1 `
  -HostName 124.220.69.209 `
  -KeyPath E:\AIproject\zyApp\.tmp\ssh\kaifa_PC.pem `
  -ExpectedCommit $candidateCommit `
  -EnableProductionPayment
```

Expected: 生产备份 SHA-256 通过；迁移为 18；生产和测试健康；资料与头像路由均为 401；正式支付为 `wechat`；测试 API 容器、数据库和迁移不变。

### Task 4: 记录正式发布证据

**Files:**
- Create: `docs/0.23.2小程序正式投产记录-2026-07-30.md`
- Modify: `docs/开发任务路线图-v1.md`
- Modify: `docs/持续开发执行台账.md`

**Interfaces:**
- Consumes: 本地验证输出、生产预检输出、备份文件名/大小、发布后状态。
- Produces: 不含密钥的可审计正式发布记录和负责人验收入口。

- [x] **Step 1: 写入自动发布证据**

记录：

```text
candidate commit
test files/tests passed
production backup basename/bytes/SHA status
production migration
production and test health
profile route status
avatar route status
production payment mode
production/test database names (names only)
test API container unchanged
test migration unchanged
formal miniapp build configuration
```

- [x] **Step 2: 标记负责人验收边界**

文档必须明确仍待负责人完成：

```text
微信开发者工具上传
正式手机号授权
真机头像上传与重进显示
负责人批准金额的真实支付
微信商户平台对账
PC/小程序/数据库账务一致性
微信审核与最终发布
```

- [x] **Step 3: 最终验证并提交**

Run:

```powershell
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm miniapp:test
git diff --check
git status --short
```

Expected: 全部通过；用户原有未跟踪文件仍未暂存；只提交本计划范围内的脚本和文档。
