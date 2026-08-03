# PC 桌游快速录入与 BGG 元数据导入设计

> 决策日期：2026-08-03
>
> 状态：产品方向与接入架构已确认；BGG Commercial Application 审核中，待书面规格复核后实施
>
> 适用范围：Windows PC 桌游资料录入、SQLite 主档、桌游同步协议、云端 BGG 适配器、小程序公开桌游契约
>
> 外部依据：[Using the XML API](https://boardgamegeek.com/using_the_xml_api)、[XML API Terms of Use](https://boardgamegeek.com/wiki/page/XML_API_Terms_of_Use)

## 1. 背景与目标

PC 已有桌游资料表单、`bggId`、本地图片、门店库存和运营状态，但录入字段多且主要依赖手工填写。现有 PC 主档仍使用 `light / medium / heavy` 难度枚举；小程序公开接口已经使用 `0.0–5.0` 的 `complexityRating`，因此 PC、SQLite、同步协议与小程序公开投影存在字段断层。

本轮目标是建立一条快速且可降级的录入链路：

1. 店长可按名称、BGG ID 或 BGG 链接搜索候选桌游。
2. 选择候选后自动带入准确的 BGG ID、人数、时长、复杂度及可映射分类。
3. 中文名称、中文简介和公开分类由店长确认，不能把未经确认的外部文本直接发布到小程序。
4. PC、SQLite、同步协议、云端主档与小程序公开 DTO 统一使用同一数字复杂度。
5. BGG Token 只保存在云端，Electron renderer、安装包、小程序、SQLite 和 Git 均不可获得 Token。
6. BGG 未配置、审核未通过、限流或不可达时，完整手工录入仍然可用。
7. 最终保存继续使用现有本地业务事务，同时写入桌游主档、门店配置、审计与 outbox。

## 2. 已确认的产品决策

### 2.1 数据准确度与中文内容

BGG 负责结构化候选数据，店长对进入 ZyApp 的最终资料负责：

- `bggId`、人数、时长和 BGG 平均复杂度可以自动带入。
- 中文名称优先从 BGG 别名中寻找候选，但必须由店长确认或修改。
- 中文简介由店长独立编写或粘贴有合法使用权的内容；不自动翻译、改写或公开 BGG description。
- BGG 分类和机制先经过本地中文映射，再由店长勾选或修改；未映射英文标签不得自动成为公开分类。
- BGG 候选只填充编辑器，不自动创建记录，也不自动改变现有记录。

### 2.2 数据源优先级

首个正式适配器只实现 BGG XML API2。集石没有可核验的公开授权 API，因此本轮不调用非公开接口、不抓取网页，也不反向分析客户端接口。

外部数据源使用统一适配器接口。未来取得集石正式 API 与书面授权后，可以新增 `JishiBoardGameMetadataAdapter`，但不得改变 PC 编辑器、内部候选 DTO、桌游主档或小程序公开 DTO。

### 2.3 BGG 商业许可状态

BGG Commercial Application 正在审核。代码开发可以先完成禁用态、契约、解析器、缓存、模拟适配器和界面，但真实 BGG 请求必须同时满足：

- 服务端已配置获批应用的 Token。
- 商业许可覆盖当前线下桌游吧管理与顾客小程序场景。
- 对图片和公开展示的许可范围已经明确。
- 公开展示 BGG 数据时按许可要求显示来源和链接到 BGG 的 `Powered by BGG` 标识。

未满足时，生产环境的 BGG 适配器保持不可用，界面提示“BGG 接入尚未启用”，手工录入不受影响。

### 2.4 权限与门店范围

- 搜索外部候选是只读操作，只有拥有 `content.manage` 的店长可使用。
- 新增或编辑桌游资料继续只允许店长。
- 店员和店长均可修改的库存、可用、缺件、寄存、公开状态和备注继续使用现有独立运营入口。
- 桌游资料仍是租户级共享主档；数量、推荐、公开和运营状态仍是门店级配置。
- BGG ID 在租户内唯一，防止同一商户的多门店重复创建同一桌游主档。

## 3. 方案比较

### 3.1 采用：云端 BGG 适配器

```text
PC renderer
  -> 具名 preload IPC
  -> Electron main 的桌游元数据客户端
  -> 已有设备认证 HTTPS
  -> NestJS 元数据查询服务
  -> Redis 缓存与全局限流
  -> BGG XML API2
```

优点：Token 不进入客户端；可以统一缓存、限流、授权和审计；以后小程序或其他管理端可复用；符合 BGG 优先服务端请求的指导。缺点：搜索依赖网络和云端 API，但手工录入仍可离线使用。

### 3.2 不采用：Electron 直接请求 BGG

实现较少，但 Token 会进入可分发安装包，无法可靠保密；每台 PC 独立限流和缓存，也不符合现有 renderer 安全边界，因此不采用。

### 3.3 不采用：本地维护完整 BGG 数据镜像

离线搜索快，但会引入全量数据下载、更新、授权、存储和版本维护；当前单店低频录入不需要完整镜像，因此不采用。

## 4. 组件与边界

### 4.1 共享合同

`packages/contracts` 增加内部元数据查询合同，和公开小程序 DTO 分离：

```ts
type BoardGameMetadataSource = 'bgg'

type BoardGameMetadataSearchRequest = {
  query: string
}

type BoardGameMetadataCandidate = {
  source: BoardGameMetadataSource
  externalId: string
  primaryName: string
  alternateNames: string[]
  yearPublished: number | null
}

type BoardGameMetadataDetails = BoardGameMetadataCandidate & {
  minPlayers: number
  maxPlayers: number
  minMinutes: number | null
  maxMinutes: number | null
  complexityRating: number | null
  categories: string[]
  mechanics: string[]
  thumbnailUrl: string | null
  imageUrl: string | null
  sourceUrl: string
  fetchedAt: string
}
```

候选 DTO 不包含 BGG description，避免把外部正文误当作可修改的中文简介。所有字符串、数组长度、URL、数字范围和 XML 节点都在服务端解析边界校验。

现有桌游合同调整为：

- `BoardGameSummary` 增加 `complexityRating: number | null`。
- `SaveBoardGameFields` 接受 `complexityRating?: number`。
- `bggId` 保留，作为 BGG 来源记录和租户级去重键。
- 兼容期保留 `difficulty`，但新 PC 编辑器与小程序不再让用户维护或读取它。

### 4.2 云端适配器

NestJS 新增单一职责组件：

- `BoardGameMetadataController`：设备认证、权限与输入校验。
- `BoardGameMetadataService`：缓存、限流、适配器选择和错误转换。
- `BggBoardGameMetadataAdapter`：XML API2 请求、XML 解析和内部 DTO 映射。
- `BoardGameMetadataCache`：Redis TTL 缓存。
- `BoardGameCategoryMapper`：BGG 英文分类/机制到 ZyApp 中文分类候选的显式映射。

只使用官方端点：

- 搜索：`/xmlapi2/search?query=<query>&type=boardgame`
- 详情：`/xmlapi2/thing?id=<id>&stats=1`

真实请求带 `Authorization: Bearer <token>`。服务端对未命中缓存的 BGG 请求执行全实例共享限流，相邻请求至少间隔 5 秒；搜索结果缓存 24 小时，详情缓存 7 天。Redis 不可用时拒绝访问 BGG 并返回可重试的外部服务不可用错误，避免失去全局限流保护后直接放大流量。

### 4.3 Electron 边界

renderer 只通过具名 preload API 调用：

- `searchBoardGameMetadata(request)`
- `getBoardGameMetadataDetails(request)`

Electron main 使用已有设备凭据访问 ZyApp API。renderer 不直接 `fetch` BGG 或 ZyApp 云端，不读取 Token，不解析 XML，也不持有任意网络访问能力。

### 4.4 PC 录入界面

“新增桌游”保留一个编辑器，但分成三个连续区域：

1. **快速查找**：名称、BGG ID 或 BGG 链接输入框；按回车或点击按钮才搜索，不随每次按键请求。
2. **公开资料**：中文名称、中文简介、中文分类、人数、时长、数字复杂度和图片。
3. **本店配置**：数量、可用、公开、推荐、寄存、缺件与备注。

搜索结果使用紧凑列表展示原名、别名、年份和 BGG ID。选择结果后再读取详情，并预填结构化字段。自动填充的字段显示“来自 BGG，保存前请核对”；中文名称、简介与分类始终可编辑。

如果输入是以下形式，直接解析 ID 并跳过搜索列表：

- 正整数 BGG ID。
- `https://boardgamegeek.com/boardgame/<id>/...` 链接。

首次新增时：

- `complexityRating` 对公开且可玩记录必填，范围 `0.0–5.0`，最多一位小数。
- 未取得图片许可时，不展示或保存 BGG 图片；仍可使用现有本地图片上传和合法 URL。
- 若同租户已有相同 `bggId`，不创建重复主档，提示用户打开现有桌游并配置当前门店。

本轮不增加批量抓取、自动翻译、自动保存、定时刷新或一键覆盖现有资料。它们会增加授权与误覆盖风险，也不是解决单款快速录入的必要条件。

## 5. 数据模型与同步一致性

### 5.1 SQLite

`board_game` 增加：

- `complexity_tenths INTEGER NULL CHECK (complexity_tenths BETWEEN 0 AND 50)`
- `metadata_source TEXT NULL CHECK (metadata_source IN ('bgg'))`
- `metadata_imported_at TEXT NULL`

SQLite 以十分之一为单位保存整数，例如 `23` 表示 `2.3/5`，repository 在合同边界转换为 `complexityRating: 2.3`。这样既保持小程序和云端的数字合同，又避免二进制浮点导致一位小数约束误判。

增加租户级 BGG ID 唯一索引：

```sql
CREATE UNIQUE INDEX uq_board_game_tenant_bgg_id
ON board_game(tenant_id, bgg_id)
WHERE bgg_id IS NOT NULL;
```

迁移前先检测历史重复 `bgg_id`。发现重复时不得自动合并或删除，升级检查明确列出冲突记录，待店长确认保留项后再继续。

旧 `difficulty` 列在兼容期保留。新写入按复杂度派生兼容值：`0.0–2.0 -> light`、`2.1–3.5 -> medium`、`3.6–5.0 -> heavy`；该值不进入新 PC 展示或小程序 DTO。

### 5.2 云端 PostgreSQL

现有 `cloud_board_game.complexity_rating` 继续作为权威数字复杂度投影，并增加与 SQLite 一致的来源时间字段和租户级 BGG ID 唯一约束。门店配置不重复保存复杂度，因为复杂度属于共享主档，不是门店状态。

### 5.3 同步协议

所有桌游创建、更新、首次基线和云端镜像物化都携带：

- `complexityRating`
- `metadataSource`
- `metadataImportedAt`

云端操作解析器对数字范围和一位小数重新校验，不能信任 PC。非财务 v2 字段合并把这些字段作为桌游主档字段处理；它们与门店数量、公开状态和备注不互相覆盖。

最终保存继续在同一 SQLite 事务中更新主档、门店配置、审计和 outbox。外部搜索本身不写业务表、不生成 outbox；只有店长确认保存后才形成经营变更。

### 5.4 小程序公开契约

小程序继续只读取现有 `PublicBoardGameSummary`：

- `name` 和 `introduction` 来自店长确认的中文主档。
- `categories` 来自店长确认的中文分类。
- `minPlayers / maxPlayers`、`minMinutes / maxMinutes` 和 `complexityRating` 来自同一桌游主档投影。
- 当前门店数量、公开、可用、缺件和启用状态仍由公开 API 统一过滤。
- `internalNote`、寄存人、缺件详情、精确数量、外部 Token 和原始 BGG 响应永不进入公开 DTO。

因此 PC 录入完成后无需再做小程序专用转换或重复录入。

## 6. BGG 署名与图片策略

BGG 来源信息不和店方独立创作的中文内容混淆：

- PC 候选区显示 `Data source: BoardGameGeek` 和候选链接。
- 若最终公开数据包含 BGG 授权数据，小程序桌游库增加符合许可要求、可点击的 `Powered by BGG` 署名入口。
- `metadataSource` 和 `bggId` 用于判断该记录是否需要来源说明。
- 原始 XML 不进入业务数据库或 Git 测试夹具；缓存仅保存规范化候选 DTO。
- 图片功能由服务端许可能力开关控制，默认关闭。只有书面许可明确覆盖图片和顾客公开展示后才启用 BGG 图片候选。
- 店长自己上传或拥有合法 URL 的封面继续使用现有图片链路，不受 BGG 开关影响。

## 7. 错误、降级与安全

### 7.1 可恢复错误

- 未配置 Token 或许可开关关闭：显示“BGG 接入尚未启用”，保留手工录入。
- 搜索无结果：保留输入，支持改名、粘贴 ID 或转手工录入。
- BGG 返回 `401/403`：记录脱敏配置错误，不自动重试，不在客户端暴露响应正文。
- BGG 返回 `429/500/503` 或超时：返回“BGG 暂时繁忙”，保留编辑器内容，允许稍后使用同一查询重试。
- XML 缺字段或格式变化：拒绝该候选并记录结构化诊断，不使用零值伪造人数、时长或复杂度。
- Redis 不可用：不绕过全局限流访问 BGG，手工录入继续可用。
- ZyApp 云端不可达：PC 不调用外部搜索，但本地手工保存和现有 outbox 继续工作。

### 7.2 数据保护

- Token 只从 API 服务端环境变量读取，日志统一脱敏。
- API 只接受设备认证和具备 `content.manage` 的当前员工上下文。
- 查询最长 120 个字符；搜索最多返回 20 个候选；XML 响应设置大小、连接和总耗时上限。
- 外部 URL 由服务端固定为 `https://boardgamegeek.com`，客户端不能提交任意上游地址，避免 SSRF。
- BGG description、评论、用户信息、收藏和论坛数据不请求、不缓存、不保存。

## 8. 测试与验收

### 8.1 自动化测试

至少覆盖：

- 共享合同接受合法搜索、候选和一位小数复杂度，拒绝越界或多位小数。
- BGG 搜索 XML 正确解析 ID、名称、别名和年份。
- BGG 详情 XML 正确解析人数、时长、平均复杂度、分类和机制。
- 缺失复杂度时返回 `null`，不伪造为 `0.0`。
- HTML/XML 实体和异常节点不会注入界面或破坏解析。
- Redis 命中时不访问 BGG；未命中时执行至少 5 秒全局限流并写入 TTL。
- Token 缺失、许可关闭、`401/403/429/500/503`、超时和畸形 XML 转换为稳定错误类型。
- renderer 只能通过具名 preload API 搜索，不包含 BGG Token 或直接 BGG URL 请求代码。
- 选择候选只填充编辑器，不调用 `createBoardGame`。
- 店长确认保存后，复杂度、来源、审计和 outbox 同事务写入。
- 相同租户重复 BGG ID 被拒绝，不同租户可各自保存。
- SQLite、同步上传、云端投影、下行镜像和首次基线完整保留数字复杂度。
- 小程序公开接口返回与 PC 保存一致的中文名称、简介、分类、人数、时长和复杂度。
- 未配置 BGG 时，现有纯手工录入回归测试继续通过。

测试中的 XML 使用最小化合成夹具，不复制 BGG 游戏描述或其他用户提交内容。

### 8.2 人工验收

1. 未配置 Token 启动 PC，确认可看到禁用说明并完成手工录入。
2. 配置测试 Token 后，以中文名、英文名、BGG ID 和 BGG 链接分别查找。
3. 选择候选，确认人数、时长和复杂度自动填入，中文名称、简介和分类仍可编辑。
4. 不保存直接关闭编辑器，确认数据库、审计和 outbox 均没有新增记录。
5. 保存一款桌游，确认 PC 列表字段正确并产生一次审计和一次同步操作。
6. 再次导入相同 BGG ID，确认系统提示打开现有记录而不是重复创建。
7. 断网后确认搜索失败但手工录入和离线保存可用；联网后 outbox 正常同步。
8. 在云端核对复杂度、来源和门店配置，再用小程序确认中文名称、简介、分类、人数、时长和复杂度一致。
9. 将桌游设为不公开、不可用、数量为零或缺件，确认小程序按现有规则隐藏。
10. 核对日志、诊断导出、renderer bundle 和安装包中不存在 BGG Token。
11. 在获批许可范围内启用署名或图片功能，确认 `Powered by BGG` 链接和图片策略符合书面许可。

## 9. 实施顺序与发布闸门

实施按以下顺序推进：

1. 共享合同、SQLite 数字复杂度迁移和桌游 repository。
2. 同步协议、云端投影、下行镜像和重复 BGG ID 约束。
3. BGG 配置、适配器、Redis 缓存、限流和设备认证端点。
4. Electron main/preload 客户端与 PC 快速录入界面。
5. 小程序契约一致性回归、自动化测试、构建和桌面打包烟测。
6. 获批 Token 的测试环境联调与人工验收。

代码完成不等于允许生产启用 BGG。生产启用还必须满足：

- BGG 已批准 Commercial Application。
- 许可用途与当前真实使用方式一致。
- Token 已通过生产密钥管理配置，未进入代码或安装包。
- 图片、公开展示和署名要求已经书面确认并正确实现。
- 所有公开可玩桌游的中文名称、中文简介、中文分类和数字复杂度已人工复核。
- 测试 API、PC、同步、云端数据库和微信体验版完成真实数据验收。

## 10. 明确不包含

- 抓取集石或 BGG 网页、调用未授权私有接口。
- 自动翻译或 AI 改写 BGG description。
- 全量 BGG 数据镜像、批量扫库或定时爬取。
- 自动覆盖现有中文名称、简介、分类或门店运营状态。
- 桌游评论、星级评价、预约、借出、桌台、实体副本编号或商品数量库存。
- 独立 Web 管理后台。
