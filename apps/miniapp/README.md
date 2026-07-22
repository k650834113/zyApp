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

仓库未填写本机端点配置时，默认构建生成纯前端 Mock 包，不访问网络。连接真实测试 API 前，需复制并填写 `config/public-endpoints.local.json`；该文件已被 Git 忽略。真实微信登录仍要求测试 API 配置对应 AppID/AppSecret，并完成合法请求域名与隐私设置。微信支付验签/解密、主动查单、退款和提审仍需平台资源与后端适配。

测试构建与 PC 测试端应在本机配置中填写同一个测试门店；登录会话按 API 地址和门店分别保存，切换门店后不会误用旧门店的会员身份。

ICP备案审核期间，默认 `test-wechat` 构建临时把“一键登录”接到测试 API 配置的虚拟号码 `18888888888`。微信会话、会员幂等绑定、资料、余额、月卡和后续业务仍走真实测试库链路；生产环境禁止启用。备案和微信手机号能力通过后，设置 `ZYAPP_MINIAPP_TEST_VIRTUAL_PHONE_ENABLED=false` 并移除服务端 `TEST_MINIAPP_VIRTUAL_PHONE` 即恢复真实 `getPhoneNumber`。

## 文档入口

- [开发文档索引](./docs/README.md)
- [环境准备与启动](./docs/01-环境准备与启动.md)
- [架构边界与目录](./docs/02-架构边界与目录.md)
- [联调与环境切换](./docs/03-联调与环境切换.md)
- [微信平台资源与发布清单](./docs/04-微信平台资源与发布清单.md)
