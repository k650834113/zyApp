# ZyApp 桌游吧管理收银系统

ZyApp 是面向桌游门店的本地优先管理与收银系统。项目以 Windows PC 客户端为主要经营终端，提供会员、储值、月卡、收银、退款、报表、备份及旧库迁移能力，并支持云端同步和微信小程序扩展。

当前版本：`0.22.2`

> 本仓库仅保存项目工程文件。数据库、备份、日志、构建产物、安装包、生产环境配置、密钥及内部交接材料均不会提交到 Git。

## 主要功能

- Windows 桌面端：店员/店长登录、会员管理、收银、储值、月卡、退款审批、报表与备份恢复
- 本地优先：SQLite 本地镜像、断网营业、幂等操作、追加式财务账本和 outbox 同步
- 云端服务：NestJS API、Worker、PostgreSQL、Redis、设备注册和多设备同步
- 多门店：租户级员工与会员、门店级权限、独立设备身份和本地数据隔离
- 微信小程序：游客展示、会员自助、移动员工与店长功能
- Windows 发布：Electron Builder + NSIS x64 安装包

## 技术栈

- TypeScript、React、Electron
- SQLite、PostgreSQL、Redis
- NestJS、BullMQ
- pnpm workspace、Vitest、tsup、esbuild
- Docker Compose

## 工程结构

```text
apps/
  merchant-desktop/  Windows 管理与收银客户端
  api/               云端 NestJS API
  worker/            云端后台任务
  miniapp/           原生微信小程序
packages/
  auth/              身份、密码与权限规则
  cloud-db/          PostgreSQL schema 与迁移
  contracts/         跨端 DTO、事件和类型
  domain/            独立于框架的领域规则
  local-db/          SQLite schema、迁移与业务仓储
  module-registry/   功能模块注册
  observability/     日志与诊断脱敏
  sync-protocol/     同步协议与冲突类型
infra/
  docker/            本地云端开发环境
  deploy/            生产部署模板
  scripts/           构建、发布与运维脚本
```

## 环境要求

- Windows 10/11 x64
- Node.js 24
- pnpm 10.12.1（通过 Corepack 使用）
- Docker Desktop（仅本地云端服务开发需要）

## 本地开发

安装依赖：

```powershell
corepack enable
corepack pnpm install
```

复制公共端点示例文件，填写本机实际 API 地址和测试门店标识：

```powershell
Copy-Item config/public-endpoints.example.json config/public-endpoints.local.json
```

`config/public-endpoints.local.json` 已被 Git 忽略。仓库中的示例文件保持空白，不得填写真实 IP、域名或门店标识。

启动桌面端开发环境：

```powershell
corepack pnpm dev
```

构建全部工作区：

```powershell
corepack pnpm build
```

运行类型检查和测试：

```powershell
corepack pnpm typecheck
corepack pnpm test
```

构建 Windows 安装包：

```powershell
corepack pnpm package:win
```

生成的安装包位于构建输出目录，不纳入 Git。

## 本地云端环境

首次启动前，从示例文件创建本机配置：

```powershell
Copy-Item infra/docker/cloud.env.example infra/docker/cloud.env
```

`infra/docker/cloud.env` 仅用于本机并已被 Git 忽略。按需填写本地开发值后启动：

```powershell
corepack pnpm cloud:up
corepack pnpm cloud:status
```

停止服务：

```powershell
corepack pnpm cloud:down
```

## 微信小程序

构建小程序：

```powershell
corepack pnpm miniapp:build
```

构建结果位于 `apps/miniapp/dist`。未填写本机端点配置时默认生成离线 Mock 包。微信开发者工具的 `project.private.config.json` 为设备私有文件，不纳入 Git。真实 API 地址、测试门店参数、AppID、AppSecret 和支付密钥必须通过本机或部署环境提供。

## 配置与数据安全

- PC 客户端只通过 HTTPS API 访问云端，不直接连接 PostgreSQL。
- 桌面端和小程序的 API 地址从 `config/public-endpoints.local.json` 读取；Git 只提交空白的 `public-endpoints.example.json`。
- 生产数据库地址、账号、密码、Redis 凭据、微信密钥、设备注册密钥和证书不得写入源码。
- 本地开发配置使用 `infra/docker/cloud.env`；生产配置使用 `infra/deploy/production.env`。两者均已加入 `.gitignore`。
- 可提交的 `*.env.example` 只能包含占位值，不能复制真实配置。
- SQLite 数据、WAL 文件、数据库导出、备份、日志、诊断包和旧库样本均已被忽略。
- 设备令牌由 Electron 主进程使用 Windows 系统加密能力保存，renderer 不直接访问数据库或任意文件系统。
- 金额统一使用整数分；钱包、订单、月卡和退款采用追加式流水，避免覆盖历史财务记录。

提交前建议执行：

```powershell
git status --short
git diff --check
```

并再次确认暂存区中不存在 `.env`、数据库、备份、证书、日志、安装包或真实连接信息。

## 生产部署

生产部署模板位于 `infra/deploy`。请从 `production.env.example` 创建服务器本地的 `production.env`，生成独立的随机密码和密钥，并确保 PostgreSQL、Redis 和内部 API 端口不直接暴露到公网。

生产配置、服务器地址和证书应由部署环境管理，不应提交到仓库。

## 重要业务约束

- 金额使用整数分保存和计算。
- 钱包本金与赠送余额分账，消费优先扣赠送余额。
- 财务操作必须幂等，业务记录、审计和 outbox 在同一事务中提交。
- 订单、支付、退款、钱包和月卡均保留不可删除的追加历史。
- 每台设备使用独立设备身份、SQLite、同步游标和备份。
- PC 是主要且唯一保证完整离线营业的终端。

## 授权

本项目暂未附带开源许可证，默认保留全部权利。未经授权请勿复制、分发或用于生产经营。
