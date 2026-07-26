# ZyApp 微信小程序

`apps/miniapp` 是 ZyApp 单仓库内独立的原生微信小程序子项目，使用 TypeScript、WXML 和 WXSS。小程序只访问云端 API，不直接连接 PC SQLite 或 PostgreSQL。

## 快速开始

```powershell
corepack pnpm install
corepack pnpm miniapp:build
```

然后在微信开发者工具中导入 `E:\AIproject\zyApp\apps\miniapp`。工程配置会把 `dist/` 作为小程序根目录；没有正式 AppID 时可先使用 `touristappid` 查看 Mock 页面。

持续开发时运行：

```powershell
corepack pnpm miniapp:dev
```

## 当前能力

- 游客：首页、活动和桌游展示。
- 会员：注册、年龄资格、余额、月卡、消费和储值记录。
- 员工：移动登录、会员管理、在线 PC 执行型收银与财务命令。
- 店长：活动、公告、营业状态和经营摘要。
- 内容：桌游运营状态维护。

仓库未填写本机端点配置时，默认构建生成纯前端 Mock 包，不访问网络。连接真实测试 API 前，需复制并填写 `config/public-endpoints.local.json`；该文件已被 Git 忽略。真实微信登录要求测试 API 配置对应 AppID/AppSecret，并完成合法请求域名与隐私设置。

测试构建与 PC 测试端应在本机配置中填写同一个测试门店；登录会话按 API 地址和门店分别保存，切换门店后不会误用旧门店的会员身份。

## 正式测试版

正式测试版使用真实微信登录、真实手机号授权和真实微信支付，但会员、余额、月卡和历史数据只写入隔离测试库。充值界面与正式版一致，提供 100、300、500、1000 元快捷金额和最低 0.01 元的自定义金额；测试者自行输入 0.01 元时，资金会真实进入商户号，测试钱包只增加本金 1 分。

构建前在被 Git 忽略的 `config/public-endpoints.local.json` 中配置测试门店 ID，API 地址必须是 `https://judian.icu/test`。也可以通过环境变量构建：

```powershell
$env:ZYAPP_MINIAPP_MODE='production-test-wechat'
$env:ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED='false'
$env:ZYAPP_MINIAPP_API_BASE_URL='https://judian.icu/test'
$env:ZYAPP_MINIAPP_STORE_ID='替换为测试门店 UUID'
corepack pnpm miniapp:build
```

微信公众平台“小程序后台 → 开发管理 → 开发设置 → 服务器域名”需要保存以下配置：

```text
request 合法域名：https://judian.icu
uploadFile 合法域名：https://judian.icu
downloadFile 合法域名：https://judian.icu
socket 合法域名：留空
```

保存后等待平台配置生效，在开发者工具中开启合法域名校验并重新编译。头像上传和重新进入后的头像显示必须使用真机验证；当前不使用 WebSocket、UDP、TCP 或 DNS 预解析，对应配置留空。

若仍出现 `uploadFile:fail url not in domain list`，应确认配置的是
`uploadFile` 合法域名，而不只是 `request` 合法域名。保存后重新编译并重启开发者工具或重新上传体验版。新会员注册时头像选填，可先使用默认头像完成注册，之后再从“我的资料”上传。

只有账号管理员能完成以下平台和真机操作：

- 确认小程序 AppID、隐私保护指引和手机号能力；
- 确认商户平台微信支付公钥切换已完成；
- 使用体验版完成手机号授权和 0.01 元真实支付；
- 在商户平台核对交易，并确认测试钱包只入账一次；
- 最终提交微信审核和发布。

APIv3 密钥必须保存在本机单行文件中，部署时只提供文件绝对路径，禁止粘贴到聊天、环境变量、代码、日志或截图中。商户私钥和微信支付公钥同样只通过只读密钥目录挂载到 API。当前生产 API 在正式发布前继续保持支付开关关闭，但正式小程序构建保留完整充值界面。

## 正式版与开发版隔离

同一 AppID 的微信开发版、体验版和线上版本可以并存，但构建产物必须使用明确模式：

| 用途 | 构建模式 | API | 数据与功能 |
| --- | --- | --- | --- |
| 本地开发 | `mock` 或 `test-wechat` | Mock 或 `https://judian.icu/test` | 开发调试 |
| 体验版验收 | `production-test-wechat` | 固定 `https://judian.icu/test` | 隔离测试库、完整真实微信支付 |
| 正式线上版 | `production-wechat` | 固定 `https://judian.icu` | 生产库、相同充值界面与支付流程 |

正式版还需在被 Git 忽略的 `config/public-endpoints.local.json` 中设置
`miniappProductionApiBaseUrl` 和 `miniappProductionStoreId`。构建器会拒绝正式版使用 HTTP、IP 地址或 `/test`，也会拒绝体验版绕过 `/test`。登录令牌按 API 地址和门店隔离，因此体验版不会复用正式版会话。

充值金额统一按整数分提交。四个快捷金额与自定义金额使用同一个
`POST /v1/member/recharge-orders` 接口，赠送余额按门店当前生效的充值规则计算；
体验版不再有自动锁定 0.01 元的专用流程。

月卡在会员首页以独立醒目卡片展示。未开通会员可直接使用微信支付开通；
已有生效月卡可续费并从当前到期时间顺延。月卡支付与储值充值使用不同订单，
月卡结算不会增加储值余额；暂停中的月卡必须由门店恢复后才能续费。PC 刷新云端
数据后会显示月卡及其“微信支付”来源。

测试 API 发布脚本只迁移并重建 `api-test`，不重启生产 `api` 或共享 Caddy；发布后还会确认两个生产容器 ID 未变化、生产和测试健康检查均为 200，并确认资料保存路由返回 401 而不是 404。小程序代码先生成体验版并完成真机验收，验收通过后再合并和推送 Git。

## 文档入口

- [开发文档索引](./docs/README.md)
- [环境准备与启动](./docs/01-环境准备与启动.md)
- [架构边界与目录](./docs/02-架构边界与目录.md)
- [联调与环境切换](./docs/03-联调与环境切换.md)
- [微信平台资源与发布清单](./docs/04-微信平台资源与发布清单.md)
