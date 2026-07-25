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

正式测试版使用真实微信登录、真实手机号授权和真实微信支付，但会员、余额、月卡和历史数据只写入隔离测试库。小额支付测试固定为 0.01 元：资金会真实进入商户号，测试钱包只增加本金 1 分，不产生赠送余额或高级会员资格。

构建前在被 Git 忽略的 `config/public-endpoints.local.json` 中配置测试门店 ID，API 地址必须是 `https://judian.icu/test`。也可以通过环境变量构建：

```powershell
$env:ZYAPP_MINIAPP_MODE='production-test-wechat'
$env:ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED='false'
$env:ZYAPP_MINIAPP_API_BASE_URL='https://judian.icu/test'
$env:ZYAPP_MINIAPP_STORE_ID='替换为测试门店 UUID'
corepack pnpm miniapp:build
```

微信公众平台“小程序后台 → 开发管理 → 开发设置 → 服务器域名”只需把 `https://judian.icu` 填入 request 合法域名。当前功能不使用 WebSocket、文件上传或文件下载，对应域名留空。

只有账号管理员能完成以下平台和真机操作：

- 确认小程序 AppID、隐私保护指引和手机号能力；
- 确认商户平台微信支付公钥切换已完成；
- 使用体验版完成手机号授权和 0.01 元真实支付；
- 在商户平台核对交易，并确认测试钱包只入账一次；
- 最终提交微信审核和发布。

APIv3 密钥必须保存在本机单行文件中，部署时只提供文件绝对路径，禁止粘贴到聊天、环境变量、代码、日志或截图中。商户私钥和微信支付公钥同样只通过只读密钥目录挂载到测试 API。生产 API 的微信支付保持禁用。

## 文档入口

- [开发文档索引](./docs/README.md)
- [环境准备与启动](./docs/01-环境准备与启动.md)
- [架构边界与目录](./docs/02-架构边界与目录.md)
- [联调与环境切换](./docs/03-联调与环境切换.md)
- [微信平台资源与发布清单](./docs/04-微信平台资源与发布清单.md)
