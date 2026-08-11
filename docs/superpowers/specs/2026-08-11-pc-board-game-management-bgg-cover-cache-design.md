# PC 独立桌游管理、BGG 修复与封面缓存设计

## 1. 背景与目标

PC `0.23.3` 已具备桌游手工录入、BGG 搜索和详情导入能力，但当前真实使用存在三个问题：

1. BGG 名称搜索会整体失败，无法正常取得候选资料。
2. “桌游资料”仍嵌套在“内容管理”页，桌游数量增加后不利于查找和运营。
3. 新增桌游窗口实际宽度过小，封面预览、BGG 候选和公开资料表单挤在单列中。

本轮目标是修复真实 BGG 搜索，新增独立“桌游管理”入口，以 A1 舒适单行展示桌游，并把新增/编辑器改为宽版分栏布局。BGG 详情同时返回封面 URL 供保存前预览；保存时必须先由 ZyApp 服务端缓存封面，最终业务记录和客户端只使用 ZyApp 缓存地址。

## 2. 已确认决策

- 左侧导航新增独立“桌游管理”；原“内容管理”只保留公告并改名为“公告管理”。
- 桌游列表采用 A1 舒适单行，每款约 100px 高，不再使用多列卡片网格。
- 每行展示封面、中文名称、简介摘要、分类、人数、时长、复杂度、内部数量、公开/可用/推荐/寄存/缺件/启停状态和 BGG ID，并保留“编辑资料”“状态与备注”“启用/停用”操作。
- 新增/编辑采用 A 方案：独立管理页上的宽版分栏弹窗，保留列表上下文。
- BGG 候选详情返回 `thumbnailUrl` 和 `imageUrl`；编辑阶段允许直接使用 BGG URL 预览。
- 保存采用方案 1：服务端同步下载、校验并缓存 BGG 封面，返回 ZyApp 自有 URL 后才保存桌游。
- 缓存失败时不关闭表单，不把 BGG 直链写入业务记录；用户可重试、上传本地图片，或明确选择默认占位图后保存。
- 默认占位图由 PC 和小程序界面渲染，不向数据库写入伪造图片 URL。
- 已确认的 BGG 署名要求继续保留，公开结果包含 BGG 来源时展示 `Powered by BGG`。

## 3. 根因与修复边界

### 3.1 BGG 搜索失败

真实 BGG XML API 搜索 `Catan` 返回的第一条候选 `134277` 只有：

```xml
<name type="alternate" value="The 7 Wonders of Catan (fan expansion for Catan)"/>
```

当前解析器强制每个候选必须存在 `type="primary"`。任何一条 alternate-only 候选都会在 `map(candidate)` 中抛错，导致整个搜索响应被转换为“BGG returned malformed metadata”。

修复规则：

- 优先使用 `type="primary"` 名称。
- 没有 primary 时使用响应中的第一条名称作为 `primaryName`。
- 被选为 `primaryName` 的名称不得再次出现在 `alternateNames`。
- 仍然拒绝完全没有名称、无合法 ID 或非 boardgame 的畸形条目。
- 用真实响应形状的最小合成 XML 建立回归测试，不保存 BGG 原始响应。

### 3.2 新增窗口过小

`.game-editor` 先声明 900px 宽度，但后出现、同等特异性的 `.modal-card` 又声明 460px，最终覆盖桌游编辑器宽度。修复不只调整规则顺序，而是为桌游编辑器定义更明确的独立布局类，避免再次受通用确认弹窗影响。

## 4. PC 信息架构与界面

### 4.1 导航与页面拆分

- `AnnouncementPage` 负责公告列表、公告编辑和发布状态。
- `BoardGamePage` 负责桌游加载、筛选、图片读取、资料编辑、运营状态编辑和启停。
- `ContentPage` 中残留的桌游状态、旧注释代码和 Tab 状态全部移出；不保留双实现。
- 店长拥有完整资料管理；店员仍仅在具备 `content.board-game.operations.manage` 时修改状态和备注。

### 4.2 A1 舒适单行

页面顶部包含：

- 关键词搜索：中文名称、分类、BGG ID。
- 状态筛选：全部、启用、停用、可用、售罄、缺件、不公开、推荐、顾客寄存。
- 分类筛选。
- 桌游总数和“新增桌游”主按钮。

桌游行按以下顺序组织：

1. 82px 左右的正方形封面；无图时显示统一占位图。
2. 名称、单行简介摘要和分类标签。
3. 人数、时长、复杂度、内部数量。
4. 运营与资料状态标签，包括 BGG ID。
5. 右侧操作按钮。

窗口变窄时先隐藏简介和次要标签，再把参数区折叠；名称、封面、关键状态和操作始终可见。

### 4.3 宽版分栏编辑器

桌游编辑器宽度为 `min(1180px, calc(100vw - 48px))`，最大高度为 `calc(100vh - 48px)`，正文区域内部滚动，标题和底部操作固定可见。

左栏约 320px：

- BGG 名称、ID 或链接输入。
- 搜索状态和候选列表。
- 当前选择的 BGG 来源与 ID。
- 大封面预览。
- “上传本地图片”“移除/使用默认封面”操作。

右栏：

- 公开资料：中文名称、简介、分类、人数、时长、复杂度。
- 本店配置：数量、可用、公开、推荐、寄存、缺件和备注。
- 编辑已有桌游时的修改原因。

BGG 详情只填充编辑器，不自动保存。中文名称、简介、分类和封面始终允许店长修改。

编辑器内部增加不直接持久化的 `coverSource`：`none | bgg | local | external | cached`。选择 BGG 详情时设为 `bgg`；上传本地图片、手工修改网络 URL、选择默认占位图时分别切换来源。打开已有 ZyApp 缓存封面时设为 `cached`，未重新选择 BGG 候选就不重复缓存。

## 5. BGG 封面缓存

### 5.1 预览阶段

`BoardGameMetadataDetails` 在图片能力启用时返回 BGG 的 `thumbnailUrl` 和 `imageUrl`。PC 优先预览 `imageUrl`，缺失时使用 `thumbnailUrl`。此地址只存在于未保存的编辑状态，不进入 SQLite、PostgreSQL、outbox 或公开桌游 DTO。

### 5.2 保存阶段

新增或编辑的表单同时满足以下条件时执行服务端缓存：

- `metadataSource === 'bgg'`。
- 存在合法的正整数 `bggId`。
- 当前封面仍标记为 BGG 来源；用户没有改成本地图片、店方 URL 或默认占位图。

Electron 主进程在调用本地 `createBoardGame` / `updateBoardGame` 前，调用新的受设备认证接口：

```text
POST /v1/board-game-metadata/bgg/:externalId/cache-cover?actorId=<employeeId>
```

客户端不提交任意上游 URL。服务端根据 BGG ID 取得已规范化详情或重新读取详情，由固定适配器选择 `imageUrl ?? thumbnailUrl`，从而保持 SSRF 边界。

成功响应：

```ts
type CacheBoardGameCoverResult = {
  source: 'bgg'
  externalId: string
  cachedUrl: string
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  sha256: string
}
```

主进程用 `cachedUrl` 替换待保存请求中的 `imageUrl`，随后执行现有本地事务。SQLite 主档、门店配置、审计和 outbox 仍保持一次事务写入；同步和云端投影只接收 ZyApp URL。

### 5.3 服务端存储

新增独立 `BoardGameCoverCacheService`，复用会员头像的持久文件模式但不混用目录或路由：

- 生产目录：`/app/data/board-game-covers`。
- 测试目录：独立 Docker volume 的同一容器路径。
- 公开路由：`GET /v1/public/board-game-covers/:fileName`。
- 文件名：`<sha256>.<jpg|png|webp>`，相同内容自动复用。
- 响应：`Cache-Control: public, max-age=31536000, immutable`。
- 最大下载 10 MiB；限制连接和总超时；只接受 HTTPS。
- 以文件签名检测 JPEG、PNG、WebP，不能只信任扩展名或 `Content-Type`。
- 先写随机临时文件，再原子重命名；失败清理临时文件。
- 不保存 BGG Token、原始 XML 或响应正文。

服务端缓存成功但随后 PC 本地事务失败时，内容哈希文件可安全保留并供重试复用。本轮不增加自动垃圾回收。

## 6. 保存失败与降级

BGG 封面缓存失败时：

- 保留所有表单字段、候选、封面预览和滚动位置。
- 显示稳定错误，不暴露上游响应正文。
- 提供“重试缓存”“上传本地图片”“使用默认封面并保存”三个明确动作。
- 只有用户选择默认封面后，才清除 BGG 封面来源并以空 `imageUrl` 继续保存。
- 不允许静默退回 BGG 直链。

BGG 搜索或详情不可用时，手工录入、本地图片和默认占位图继续可用。纯离线模式不尝试服务端缓存。

## 7. 数据、同步与兼容性

- 现有 `image_url` 字段足以保存 ZyApp 缓存 URL，不新增 SQLite 或 PostgreSQL 列。
- `bgg_id`、`metadata_source` 和 `metadata_imported_at` 继续记录资料来源；封面缓存 URL 不改变这些字段。
- 老记录中的本地路径和合法外部 URL 保持可读，不进行强制批量迁移。
- 新保存的 BGG 封面禁止保留 `cf.geekdo-images.com` 等 BGG CDN 地址。
- 已保存记录在 PC 和小程序中只访问 ZyApp 缓存 URL；保存前编辑器仍可直接预览 BGG URL。
- PC 和小程序统一以 `imageUrl === null` 渲染默认占位图。
- 测试与生产的缓存卷严格隔离，测试 URL 不得进入生产记录。

## 8. 安全与权限

- 状态、搜索、详情和缓存封面均要求有效设备身份与当前门店店长权限。
- Electron renderer 仍只调用具名 preload API，不读取设备令牌、文件系统或数据库。
- 缓存接口只接受 BGG ID，不接受任意图片 URL。
- 下载地址必须由 BGG 适配器生成并通过 HTTPS、允许主机和重定向校验。
- 下载限制大小、超时和重定向次数；错误日志只记录 BGG ID、错误分类和内部请求关联号。
- 公开图片路由只接受内容哈希文件名，拒绝路径穿越。

## 9. 测试与验收

实现遵循测试驱动，至少覆盖：

1. alternate-only BGG 搜索条目不再使整个结果失败，且 primary 名称仍优先。
2. 详情解析在图片开关启用时返回安全 HTTPS URL，关闭时仍返回 `null`。
3. 封面缓存接受合法 JPEG/PNG/WebP，按 SHA-256 去重并能公开读取。
4. 拒绝超限、超时、非图片、签名不匹配、非 HTTPS、非允许主机和危险重定向。
5. 缓存接口要求设备认证和店长权限，只接受合法 BGG ID。
6. PC 保存 BGG 导入资料时先取得缓存 URL，再调用本地创建/更新。
7. 缓存失败不调用本地保存，并保留编辑器内容。
8. 选择本地图片或默认占位图后不调用 BGG 缓存接口。
9. 保存请求、SQLite、outbox、云端投影和公开 DTO 中不出现 BGG CDN URL。
10. 独立桌游导航、A1 单行信息、筛选、权限和宽版弹窗有 renderer 行为测试。
11. 460px 通用 modal 样式不能覆盖桌游编辑器宽度。
12. 现有公告管理、手工桌游录入、本地图片、店员状态修改和小程序桌游库回归通过。

人工验收至少使用中文名、英文名、BGG ID 和 BGG 链接各查询一次；确认候选、结构化字段和封面预览；保存后检查记录只含 `judian.icu` 缓存 URL，并在 PC 与小程序验证封面。另模拟缓存失败，逐一验证重试、本地图片和默认占位图。

## 10. 发布与配置

- `BGG_PUBLIC_IMAGES_ENABLED` 在实现、自动化测试和测试环境真实缓存验收通过后改为 `true`。
- Compose 为生产和测试 API 分别挂载 `board-game-cover-production` 与 `board-game-cover-test` 卷。
- 发布顺序保持测试先行；测试环境确认缓存文件、公开 URL、数据库 URL、跨端展示和卷持久化后再发布生产。
- 更新正式需求基线、发布验收记录和版本说明；不得把 BGG Token 或缓存源 URL 写入安装包和日志。

## 11. 不包含

- 批量抓取或批量回填全部桌游封面。
- 自动翻译、自动生成中文简介或覆盖店方中文资料。
- 定时刷新已经缓存的封面。
- 通用对象存储平台、COS 迁移或自动图片垃圾回收。
- 集石或其他未授权数据源。
