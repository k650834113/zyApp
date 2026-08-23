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
- 工具：游客可直接使用多点触控先手与分队、自定义组合骰子、带正反统计的抛硬币和表格式多人计分器；结果与本局记录仅在本机生成，不依赖后端。

常规 `miniapp:build` 默认生成纯前端 Mock 包，只用于本地开发。小程序不再提供 `test-wechat` 或 `production-test-wechat` 发布通道，任何要上传的代码都必须使用正式构建命令。

## 正式版

正式版使用真实微信登录、真实手机号授权、真实微信支付和生产数据。构建前在被 Git 忽略的 `config/public-endpoints.local.json` 中配置 `miniappProductionApiBaseUrl` 和 `miniappProductionStoreId`，API 必须严格为 `https://judian.icu`。

```powershell
corepack pnpm miniapp:build:production
```

该命令会强制 `production-wechat`，清除当前 shell 中遗留的通用 API、门店和认证覆盖项，并拒绝 HTTP、IP 地址、`/test`、Mock 支付、开发登录和非正式门店。

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
- 在商户平台和正式钱包核对交易只入账一次；
- 最终提交微信审核和发布。

APIv3 密钥必须保存在本机单行文件中，部署时只提供文件绝对路径，禁止粘贴到聊天、环境变量、代码、日志或截图中。商户私钥和微信支付公钥同样只通过只读密钥目录挂载到 API，小程序包内不包含任何长期密钥。

## 正式版与本地开发隔离

同一 AppID 的微信开发版、体验版和线上版本可以并存，但三者上传的都是同一份正式通道产物：

| 用途 | 构建模式 | API | 数据与功能 |
| --- | --- | --- | --- |
| 本地开发 | `mock` 或 `development-http` | Mock 或本机 API | 不可上传 |
| 开发版 / 体验版 / 正式版 | `production-wechat` | 固定 `https://judian.icu` | 生产库、真实登录与支付 |

桌游库通过正式门店的 `GET /v1/public/games` 读取云端真实数据；Mock、本地 API 和测试 API 不会进入可上传产物。

充值金额统一按整数分提交。四个快捷金额与自定义金额使用同一个
`POST /v1/member/recharge-orders` 接口，赠送余额按门店当前生效的充值规则计算；
正式版不存在自动锁定 0.01 元的专用流程。

月卡在会员首页以独立醒目卡片展示。未开通会员可直接使用微信支付开通；
已有生效月卡可续费并从当前到期时间顺延。月卡支付与储值充值使用不同订单，
月卡结算不会增加储值余额；暂停中的月卡必须由门店恢复后才能续费。PC 刷新云端
数据后会显示月卡及其“微信支付”来源。

0.23.2 初版正式基线会为已有生效月卡的会员优先显示大号到期日期，并将续费入口收为
紧凑操作。验收时还需确认 PC 待同步操作归零、PC 与云端余额一致，且现金充值、
消费和 0.01 元微信充值在最近明细中各只显示一次；显示去重不会删除原始账本记录。
完整步骤见 [0.23.2 月卡与账务一致性验收](../../docs/0.23.2月卡与账务一致性验收.md)。

小程序的开发版、体验版、审核版和正式版均使用同一份 `production-wechat` 产物，不再生成或上传任何 `/test` 路径的小程序包。

## 文档入口

- [开发文档索引](./docs/README.md)
- [环境准备与启动](./docs/01-环境准备与启动.md)
- [架构边界与目录](./docs/02-架构边界与目录.md)
- [联调与环境切换](./docs/03-联调与环境切换.md)
- [微信平台资源与发布清单](./docs/04-微信平台资源与发布清单.md)
