# PC 独立桌游管理、BGG 修复与封面缓存实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 PC 端 BGG 搜索，新增保存时同步缓存 BGG 封面的安全链路，并把桌游管理拆成带 A1 单行列表和宽版分栏编辑器的独立页面。

**Architecture:** BGG XML 适配器继续只负责元数据规范化；新的服务端封面缓存服务负责受限下载、内容签名校验、SHA-256 去重和公开读取。Electron 主进程根据 renderer 传来的非持久化 `coverSource`，在本地 SQLite 事务前同步调用云端缓存接口，并只把 ZyApp URL 交给现有桌游写入流程。PC renderer 拆为公告页和桌游页，桌游编辑器保留 BGG 直链预览，但已保存记录不得包含 BGG CDN URL。

**Tech Stack:** Node.js 24、pnpm 10.12.1、TypeScript 5.9、NestJS、Electron 42、React 19、Vitest 4、SQLite/PostgreSQL、Docker Compose。

## Global Constraints

- 使用 Node.js `>=24 <25` 与 pnpm `10.12.1`；不新增第三方运行时依赖。
- 不新增 SQLite 或 PostgreSQL 字段；继续使用现有 `image_url`、`bgg_id`、`metadata_source` 与 `metadata_imported_at`。
- BGG 详情可在未保存编辑器中使用 HTTPS 图片 URL 预览；新保存的 BGG 封面只能写入 ZyApp 缓存 URL。
- 封面缓存接口只接受合法正整数 BGG ID，不接受 renderer 提交的任意上游 URL。
- 只允许 HTTPS、`cf.geekdo-images.com`、最多 3 次受校验重定向、10 MiB 上限以及 JPEG/PNG/WebP 文件签名。
- 缓存目录为 `/app/data/board-game-covers`，公开路由为 `/v1/public/board-game-covers/:fileName`，文件名为 `<sha256>.<jpg|png|webp>`。
- 公开封面响应使用 `Cache-Control: public, max-age=31536000, immutable`；写入采用临时文件加原子重命名。
- 不记录 BGG Token、原始 XML、图片响应正文或任意设备令牌；错误日志只允许 BGG ID、稳定错误分类和内部关联号。
- 店长可管理完整桌游资料；店员只在具备 `content.board-game.operations.manage` 时修改状态与备注。
- 默认封面以 `imageUrl === null` 由 PC 和小程序渲染，不写入伪造占位 URL。
- 保留当前工作区中 `.gitignore`、小程序布局、测试截图/压缩包及部署备份文件的用户改动；任何任务提交只暂存明确列出的文件。
- 本计划不部署服务器、不发布 PC 安装包，也不直接修改生产密钥或生产环境文件；`BGG_PUBLIC_IMAGES_ENABLED=true` 仅在后续测试环境真实验收通过后启用。

---

## File Structure

- `apps/api/src/board-game-metadata/bgg-xml.ts`：BGG XML 的名称、字段和图片 URL 规范化。
- `apps/api/src/board-game-cover-cache.service.ts`：受限下载、签名检测、哈希去重、原子存储和读取。
- `apps/api/src/board-game-cover.controller.ts`：不可认证但仅能按内容哈希文件名读取的公开封面路由。
- `apps/api/src/board-game-metadata/board-game-metadata.service.ts`：店长鉴权、BGG 详情获取和缓存命令编排。
- `apps/merchant-desktop/src/main/board-game-cover-save.ts`：保存前解析 BGG 封面、失败即阻止本地持久化。
- `apps/merchant-desktop/src/renderer/src/board-game-editor.ts`：编辑器状态、`coverSource` 和请求转换。
- `apps/merchant-desktop/src/renderer/src/AnnouncementPage.tsx`：原公告管理职责。
- `apps/merchant-desktop/src/renderer/src/BoardGamePage.tsx`：独立桌游加载、筛选、A1 行、编辑和运营状态。
- `apps/merchant-desktop/src/renderer/src/BoardGameEditorModal.tsx`：宽版左右分栏编辑器和缓存失败降级动作。
- `apps/merchant-desktop/src/renderer/src/styles.css`：A1 行、筛选栏、宽版编辑器和响应式规则。

### Task 1: 接纳并锁定现有 BGG alternate-only 名称修复

**Files:**
- Modify: `apps/api/src/board-game-metadata/bgg-xml.ts:66-83`
- Test: `apps/api/src/board-game-metadata/bgg-xml.test.ts:25-42`

**Interfaces:**
- Consumes: BGG `<name type="primary|alternate" value="..."/>` 节点。
- Produces: `itemNames(item): { primaryName: string; alternateNames: string[] }`，优先 primary，否则使用第一条名称且不在 alternate 中重复。

> 当前工作区已经包含用户编写的回归测试与最小修复；诊断阶段已确认旧版本在真实 `Catan` 搜索响应上失败。本任务不得回退这两处改动来人工重现红灯。

- [ ] **Step 1: 核对现有未提交差异只包含预期规则**

Run:

```powershell
git diff -- apps/api/src/board-game-metadata/bgg-xml.ts apps/api/src/board-game-metadata/bgg-xml.test.ts
```

Expected: `primary ?? names[0]` 回退和 BGG `134277` alternate-only 回归用例；无其他行为变化。

- [ ] **Step 2: 运行解析器回归测试**

Run:

```powershell
pnpm.cmd exec vitest run apps/api/src/board-game-metadata/bgg-xml.test.ts
```

Expected: PASS；primary 名称优先、alternate-only 可解析、无名称仍拒绝。

- [ ] **Step 3: 提交这两处既有修复**

```powershell
git add apps/api/src/board-game-metadata/bgg-xml.ts apps/api/src/board-game-metadata/bgg-xml.test.ts
git commit -m "fix: accept alternate-only BGG search results"
```

### Task 2: 定义封面来源意图和缓存结果契约

**Files:**
- Modify: `packages/contracts/src/index.ts:765-800`
- Modify: `packages/contracts/src/index.ts:868-875`
- Test: `packages/contracts/src/board-game-metadata.test.ts`

**Interfaces:**
- Consumes: renderer 的非持久化封面来源和 BGG ID。
- Produces: `BoardGameCoverSource`、`CacheBoardGameCoverResult`，以及带可选 `coverSource` 的创建/更新 IPC 请求。

- [ ] **Step 1: 写入失败的契约测试**

```ts
import type {
  BoardGameCoverSource,
  CacheBoardGameCoverResult,
  CreateBoardGameRequest
} from './index'

const source = 'bgg' satisfies BoardGameCoverSource
const result = {
  source: 'bgg',
  externalId: '13',
  cachedUrl: 'https://judian.icu/test/v1/public/board-game-covers/a'.concat('0'.repeat(63), '.jpg'),
  contentType: 'image/jpeg',
  sha256: 'a'.repeat(64)
} satisfies CacheBoardGameCoverResult
const request = { ...saved, coverSource: source } satisfies CreateBoardGameRequest

expect(result.cachedUrl).toContain('/v1/public/board-game-covers/')
expect(request.coverSource).toBe('bgg')
```

- [ ] **Step 2: 运行测试确认类型尚不存在**

Run:

```powershell
pnpm.cmd exec vitest run packages/contracts/src/board-game-metadata.test.ts
```

Expected: FAIL，报告 `BoardGameCoverSource` 或 `CacheBoardGameCoverResult` 未导出。

- [ ] **Step 3: 添加最小契约**

```ts
export type BoardGameCoverSource =
  | 'none'
  | 'bgg'
  | 'local'
  | 'external'
  | 'cached'

export type CacheBoardGameCoverResult = {
  source: 'bgg'
  externalId: string
  cachedUrl: string
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  sha256: string
}

export type CreateBoardGameRequest = SaveBoardGameFields & {
  coverSource?: BoardGameCoverSource
}

export type UpdateBoardGameRequest = SaveBoardGameFields & {
  boardGameId: Identifier
  reason: string
  coverSource?: BoardGameCoverSource
}
```

- [ ] **Step 4: 运行契约测试和类型检查**

Run:

```powershell
pnpm.cmd exec vitest run packages/contracts/src/board-game-metadata.test.ts
pnpm.cmd --filter @zyapp/contracts typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交契约**

```powershell
git add packages/contracts/src/index.ts packages/contracts/src/board-game-metadata.test.ts
git commit -m "feat: define board game cover cache contract"
```

### Task 3: 实现安全、可公开读取的服务端封面缓存

**Files:**
- Create: `apps/api/src/board-game-cover-cache.service.ts`
- Create: `apps/api/src/board-game-cover-cache.service.test.ts`
- Create: `apps/api/src/board-game-cover.controller.ts`
- Create: `apps/api/src/board-game-cover.controller.test.ts`
- Modify: `apps/api/src/config.ts:1-30,321-335`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/app.module.ts:1-85`
- Modify: `infra/deploy/compose.production.yml:75-185,265-272`

**Interfaces:**
- Consumes: `cacheFromBgg(externalId: string, sourceUrl: string)`，其中 URL 必须来自 BGG 适配器。
- Produces: `Promise<CacheBoardGameCoverResult>` 与 `read(fileName): Promise<{ buffer; contentType }>`。

- [ ] **Step 1: 写入失败的下载、校验、去重和读取测试**

```ts
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(jpeg, {
  status: 200,
  headers: { 'content-type': 'image/jpeg', 'content-length': String(jpeg.length) }
})))

const first = await covers.cacheFromBgg(
  '13',
  'https://cf.geekdo-images.com/catan.jpg'
)
const second = await covers.cacheFromBgg(
  '13',
  'https://cf.geekdo-images.com/catan-copy.jpg'
)

expect(first.sha256).toMatch(/^[0-9a-f]{64}$/)
expect(second.cachedUrl).toBe(first.cachedUrl)
expect((await covers.read(`${first.sha256}.jpg`)).buffer).toEqual(jpeg)
```

另用 `it.each` 覆盖非 HTTPS、非允许主机、声明或流式超过 10 MiB、超时、非图片、媒体类型与签名不匹配、危险重定向、超过 3 次重定向和路径穿越文件名。

- [ ] **Step 2: 运行测试确认服务尚不存在**

Run:

```powershell
pnpm.cmd exec vitest run apps/api/src/board-game-cover-cache.service.test.ts
```

Expected: FAIL，无法导入 `BoardGameCoverCacheService`。

- [ ] **Step 3: 实现固定边界和图片签名识别**

```ts
const MAX_COVER_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 3
const ALLOWED_HOSTS = new Set(['cf.geekdo-images.com'])
const FILE_NAME_PATTERN = /^[0-9a-f]{64}\.(jpg|png|webp)$/

function assertAllowedUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new BadRequestException('BGG cover URL is not allowed')
  }
  return url
}
```

`detectImage(buffer)` 必须按 JPEG `ff d8 ff`、PNG 8 字节签名、WebP `RIFF....WEBP` 返回扩展名和 MIME；任何不匹配抛出稳定的 `BadGatewayException('BGG cover is not a supported image')`。

- [ ] **Step 4: 实现手动重定向、超时和流式大小限制**

```ts
const response = await fetch(currentUrl, {
  method: 'GET',
  redirect: 'manual',
  signal: AbortSignal.timeout(10_000),
  headers: { Accept: 'image/jpeg,image/png,image/webp' }
})
```

对 301/302/303/307/308 使用 `new URL(location, currentUrl)` 后再次调用 `assertAllowedUrl`；超过 3 次即失败。读取每个 `ReadableStream` chunk 前累计字节数，超过 `MAX_COVER_BYTES` 时取消 reader 并失败。

- [ ] **Step 5: 实现 SHA-256 文件名和原子落盘**

```ts
const sha256 = createHash('sha256').update(buffer).digest('hex')
const fileName = `${sha256}.${detected.extension}`
const destination = join(this.directory, fileName)
const temporary = `${destination}.${randomUUID()}.tmp`
await writeFile(temporary, buffer, { flag: 'wx' })
await rename(temporary, destination)
```

目标已存在时删除临时文件并复用；其他失败也清理临时文件后原样抛出。`cachedUrl` 由 `miniappPublicBaseUrl + /v1/public/board-game-covers/ + fileName` 生成。

- [ ] **Step 6: 写入失败的公开控制器测试并实现路由**

```ts
const file = await controller.read(`${'a'.repeat(64)}.jpg`)
expect(file).toBeInstanceOf(StreamableFile)
expect(Reflect.getMetadata('__headers__', BoardGameCoverController.prototype.read))
  .toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Cache-Control', value: 'public, max-age=31536000, immutable' })
  ]))
```

控制器固定为：

```ts
@Controller('public/board-game-covers')
export class BoardGameCoverController {
  constructor(
    @Inject(BoardGameCoverCacheService)
    private readonly covers: BoardGameCoverCacheService
  ) {}

  @Get(':fileName')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async read(@Param('fileName') fileName: string): Promise<StreamableFile> {
    const cover = await this.covers.read(fileName)
    return new StreamableFile(cover.buffer, {
      type: cover.contentType,
      length: cover.buffer.length
    })
  }
}
```

- [ ] **Step 7: 增加配置、Nest wiring 和隔离卷**

```ts
boardGameCoverDirectory:
  environment.BOARD_GAME_COVER_DIRECTORY?.trim() ||
  `./var/board-game-covers/${deploymentEnvironment}`
```

生产与测试 API 分别设置 `BOARD_GAME_COVER_DIRECTORY: /app/data/board-game-covers`，挂载 `board-game-cover-production` 和 `board-game-cover-test`，并在 volumes 节声明两个不同命名卷。把 service/controller 加入 `AppModule`。

- [ ] **Step 8: 运行服务、配置和控制器测试**

Run:

```powershell
pnpm.cmd exec vitest run apps/api/src/board-game-cover-cache.service.test.ts apps/api/src/board-game-cover.controller.test.ts apps/api/src/config.test.ts
pnpm.cmd --filter @zyapp/api typecheck
```

Expected: PASS。

- [ ] **Step 9: 提交封面存储基础设施**

```powershell
git add apps/api/src/board-game-cover-cache.service.ts apps/api/src/board-game-cover-cache.service.test.ts apps/api/src/board-game-cover.controller.ts apps/api/src/board-game-cover.controller.test.ts apps/api/src/config.ts apps/api/src/config.test.ts apps/api/src/app.module.ts infra/deploy/compose.production.yml
git commit -m "feat: add secure board game cover cache"
```

### Task 4: 增加受设备认证和店长授权的 BGG 缓存命令

**Files:**
- Modify: `apps/api/src/board-game-metadata/board-game-metadata.controller.ts`
- Modify: `apps/api/src/board-game-metadata/board-game-metadata.controller.test.ts`
- Modify: `apps/api/src/board-game-metadata/board-game-metadata.service.ts`
- Modify: `apps/api/src/board-game-metadata/board-game-metadata.service.test.ts`
- Modify: `apps/api/src/board-game-metadata/board-game-metadata.wiring.test.ts`

**Interfaces:**
- Consumes: `POST /v1/board-game-metadata/bgg/:externalId/cache-cover?actorId=<employeeId>`。
- Produces: `CacheBoardGameCoverResult`；只通过适配器详情的 `imageUrl ?? thumbnailUrl` 调用 `BoardGameCoverCacheService`。

- [ ] **Step 1: 写入失败的 service 测试**

```ts
const result = await instance.cacheCover(
  principal,
  managerId,
  '13'
)

expect(adapter.details).toHaveBeenCalledWith('13')
expect(covers.cacheFromBgg).toHaveBeenCalledWith(
  '13',
  'https://cf.geekdo-images.com/catan.jpg'
)
expect(result.cachedUrl).toContain('/v1/public/board-game-covers/')
```

另覆盖非法 ID、非店长、元数据禁用、详情无图片、适配器失败和缓存失败；断言未授权时 adapter 与 cover service 均未调用。

- [ ] **Step 2: 运行 service 测试确认失败**

Run:

```powershell
pnpm.cmd exec vitest run apps/api/src/board-game-metadata/board-game-metadata.service.test.ts
```

Expected: FAIL，`cacheCover` 尚不存在或构造参数不匹配。

- [ ] **Step 3: 实现 service 编排并复用详情缓存**

```ts
async cacheCover(
  principal: DevicePrincipal,
  actorIdValue: string,
  externalIdValue: string
): Promise<CacheBoardGameCoverResult> {
  await this.requireManager(principal, actorId(actorIdValue))
  this.requireEnabled()
  const id = externalId(externalIdValue)
  const details = await this.loadDetails(id)
  const imageUrl = details.imageUrl ?? details.thumbnailUrl
  if (!imageUrl) {
    throw new BadGatewayException('BGG cover image is unavailable')
  }
  return this.covers.cacheFromBgg(id, imageUrl)
}
```

把现有 `details()` 的 gate 调用提取为私有 `loadDetails(id)`，确保详情展示和保存缓存使用同一规范化路径与稳定错误映射。

- [ ] **Step 4: 写入失败的 controller 路由测试并实现 POST**

```ts
@Post('bgg/:externalId/cache-cover')
cacheCover(
  @Req() request: DeviceRequest,
  @Query('actorId') actorId: string,
  @Param('externalId') externalId: string
) {
  return this.service.cacheCover(principal(request), actorId, externalId)
}
```

测试必须确认 `principal(request)` 缺失时返回 Unauthorized，且 service 收到 actorId 和路径 ID，而不是任意 URL。

- [ ] **Step 5: 更新 wiring 测试和构造依赖**

在所有直接 `new BoardGameMetadataService(...)` 的测试中注入 typed cover service stub；Nest 测试模块注册 `BoardGameCoverCacheService` stub，避免依赖真实文件系统或网络。

- [ ] **Step 6: 运行 metadata 全套测试**

Run:

```powershell
pnpm.cmd exec vitest run apps/api/src/board-game-metadata/bgg-xml.test.ts apps/api/src/board-game-metadata/bgg-adapter.test.ts apps/api/src/board-game-metadata/board-game-metadata.service.test.ts apps/api/src/board-game-metadata/board-game-metadata.controller.test.ts apps/api/src/board-game-metadata/board-game-metadata.wiring.test.ts apps/api/src/board-game-metadata/request-gate.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交缓存命令**

```powershell
git add apps/api/src/board-game-metadata/board-game-metadata.controller.ts apps/api/src/board-game-metadata/board-game-metadata.controller.test.ts apps/api/src/board-game-metadata/board-game-metadata.service.ts apps/api/src/board-game-metadata/board-game-metadata.service.test.ts apps/api/src/board-game-metadata/board-game-metadata.wiring.test.ts
git commit -m "feat: cache BGG covers through manager API"
```

### Task 5: 在 Electron 本地事务前同步解析缓存封面

**Files:**
- Create: `apps/merchant-desktop/src/main/board-game-cover-save.ts`
- Create: `apps/merchant-desktop/src/main/board-game-cover-save.test.ts`
- Modify: `apps/merchant-desktop/src/main/cloud-sync-client.ts:233-285`
- Modify: `apps/merchant-desktop/src/main/cloud-sync-client.test.ts:32-100`
- Modify: `apps/merchant-desktop/src/main/index.ts:4378-4452`

**Interfaces:**
- Consumes: `CreateBoardGameRequest | UpdateBoardGameRequest` 与 `coverSource`。
- Produces: 在 `coverSource === 'bgg'` 时以缓存 URL 替换 `imageUrl` 后调用现有本地 persist；缓存失败时 persist 调用次数为 0。

- [ ] **Step 1: 写入失败的云端 POST 客户端测试**

```ts
await cacheCloudBoardGameCover(connection, actorId, '13', fetchMock)
expect(fetchMock).toHaveBeenCalledWith(
  `${connection.baseUrl}/v1/board-game-metadata/bgg/13/cache-cover?actorId=${actorId}`,
  expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({
      authorization: 'Bearer secret-token',
      'x-zyapp-device-id': 'device-1'
    })
  })
)
expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body')
```

- [ ] **Step 2: 运行客户端测试确认函数不存在**

Run:

```powershell
pnpm.cmd exec vitest run apps/merchant-desktop/src/main/cloud-sync-client.test.ts
```

Expected: FAIL，`cacheCloudBoardGameCover` 未导出。

- [ ] **Step 3: 实现缓存云端客户端**

```ts
export async function cacheCloudBoardGameCover(
  connection: CloudConnection,
  actorId: string,
  externalId: string,
  fetchImpl: Fetch = fetch
): Promise<CacheBoardGameCoverResult> {
  if (!/^[1-9]\d*$/.test(externalId)) {
    throw new TypeError('BGG cover cache request is invalid')
  }
  const baseUrl = normalizeCloudBaseUrl(connection.baseUrl)
  const response = await fetchImpl(
    `${baseUrl}/v1/board-game-metadata/bgg/${encodeURIComponent(externalId)}/cache-cover?actorId=${encodeURIComponent(actorId)}`,
    {
      method: 'POST',
      headers: headers(connection),
      signal: AbortSignal.timeout(BOARD_GAME_METADATA_REQUEST_TIMEOUT_MILLISECONDS)
    }
  )
  return responseJson(response)
}
```

- [ ] **Step 4: 写入失败的保存编排测试**

```ts
await persistBoardGameWithResolvedCover(
  { ...request, bggId: 13, coverSource: 'bgg', imageUrl: 'https://cf.geekdo-images.com/catan.jpg' },
  cache,
  persist
)
expect(cache).toHaveBeenCalledWith('13')
expect(persist).toHaveBeenCalledWith(expect.objectContaining({
  imageUrl: 'https://judian.icu/test/v1/public/board-game-covers/hash.jpg',
  coverSource: 'cached'
}))
```

第二个测试令 cache reject，断言 persist 未调用；再覆盖 local、external、cached、none 和旧客户端未传 `coverSource` 时不缓存。

- [ ] **Step 5: 实现保存编排和 BGG CDN 持久化防线**

```ts
export async function persistBoardGameWithResolvedCover<TRequest, TResult>(
  request: TRequest & { bggId?: number; imageUrl?: string; coverSource?: BoardGameCoverSource },
  cache: (externalId: string) => Promise<CacheBoardGameCoverResult>,
  persist: (request: TRequest & { imageUrl?: string; coverSource?: BoardGameCoverSource }) => Promise<TResult>
): Promise<TResult> {
  if (request.coverSource !== 'bgg') return persist(request)
  if (!Number.isInteger(request.bggId) || (request.bggId ?? 0) < 1) {
    throw new TypeError('保存 BGG 封面需要有效的 BGG 编号')
  }
  const cached = await cache(String(request.bggId))
  return persist({ ...request, imageUrl: cached.cachedUrl, coverSource: 'cached' })
}
```

在 `requireBoardGameFields` 增加防线：若最终 `imageUrl` 主机为 `cf.geekdo-images.com`，抛出“BGG 封面必须先缓存到 ZyApp 服务器”。

- [ ] **Step 6: 将 create/update IPC 接入编排器**

两个 handler 改为 `async`，先要求 `content.manage` 和云连接；只有 `coverSource === 'bgg'` 时调用 `cacheCloudBoardGameCover`。传给现有 `createBoardGame` / `updateBoardGame` 的仍是 `requireBoardGameFields(prepared)`，因此 SQLite 主档、门店配置、审计和 outbox 的原事务边界不变。

- [ ] **Step 7: 运行主进程测试和类型检查**

Run:

```powershell
pnpm.cmd exec vitest run apps/merchant-desktop/src/main/cloud-sync-client.test.ts apps/merchant-desktop/src/main/board-game-cover-save.test.ts
pnpm.cmd --filter @zyapp/merchant-desktop typecheck
```

Expected: PASS。

- [ ] **Step 8: 提交主进程保存链路**

```powershell
git add apps/merchant-desktop/src/main/board-game-cover-save.ts apps/merchant-desktop/src/main/board-game-cover-save.test.ts apps/merchant-desktop/src/main/cloud-sync-client.ts apps/merchant-desktop/src/main/cloud-sync-client.test.ts apps/merchant-desktop/src/main/index.ts
git commit -m "feat: cache BGG cover before local board game save"
```

### Task 6: 扩展编辑器状态并实现宽版分栏与缓存失败降级

**Files:**
- Modify: `apps/merchant-desktop/src/renderer/src/board-game-editor.ts`
- Modify: `apps/merchant-desktop/src/renderer/src/board-game-editor.test.ts`
- Modify: `apps/merchant-desktop/src/renderer/src/BoardGameEditorModal.tsx`
- Create: `apps/merchant-desktop/src/renderer/src/BoardGameEditorModal.test.tsx`
- Modify: `apps/merchant-desktop/src/renderer/src/styles.css:3429-3467,3689-3755`

**Interfaces:**
- Consumes: BGG details、当前图片字段与 `coverCacheError`。
- Produces: `BoardGameEditor.coverSource`、可预览的宽版编辑器，以及“重试缓存 / 上传本地图片 / 使用默认封面并保存”。

- [ ] **Step 1: 写入失败的编辑器来源测试**

```ts
expect(applyMetadataDetails(defaultBoardGameEditor(), details, true))
  .toMatchObject({
    imageUrl: details.imageUrl,
    coverSource: 'bgg'
  })
expect(boardGameRequest({
  ...defaultBoardGameEditor(),
  name: '卡坦岛',
  introduction: '通过交易与建设发展岛屿。',
  categories: '经营',
  coverSource: 'none'
})).toMatchObject({ coverSource: 'none' })
```

增加已有 ZyApp `/v1/public/board-game-covers/` URL 初始化为 `cached`、本地路径初始化为 `local`、普通网络 URL 初始化为 `external` 的用例。

- [ ] **Step 2: 运行测试确认 `coverSource` 不存在**

Run:

```powershell
pnpm.cmd exec vitest run apps/merchant-desktop/src/renderer/src/board-game-editor.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现编辑器来源状态和请求输出**

```ts
// Append this field after the existing `reason` field in BoardGameEditor.
coverSource: BoardGameCoverSource

// BGG 详情成功且有图片时：
coverSource: imagesEnabled && (details.imageUrl || details.thumbnailUrl)
  ? 'bgg'
  : editor.coverSource

// boardGameRequest 返回：
coverSource: editor.coverSource
```

导入本地图片时同时设置 `coverSource: 'local'`、清空 `imageUrl`；手改网络 URL 时设置 `external` 并清空本地路径/预览；移除封面时清空三项图片字段并设 `none`。

- [ ] **Step 4: 写入失败的 modal 静态渲染测试**

使用 `renderToStaticMarkup` 断言编辑器包含 `game-editor-shell`、`game-editor-source-pane`、`game-editor-fields-pane`、封面预览和 BGG ID。传入 `coverCacheError` 时断言三个动作按钮文案完整，未传错误时不显示降级区。

- [ ] **Step 5: 重排 modal 为固定头尾和左右分栏**

```tsx
<form className="modal-card game-editor-shell" onSubmit={onSubmit}>
  <header className="game-editor-header">
    <div className="form-heading">
      <span>桌游资料</span>
      <h2>{editor.current ? `编辑 ${editor.current.name}` : '快速新增桌游'}</h2>
    </div>
  </header>
  <div className="game-editor-body">
    <aside className="game-editor-source-pane">
      <h3>BGG 快速查找</h3>
      <div className="metadata-search">
        <input aria-label="BGG 桌游名称、ID 或链接" value={lookup} />
        <button type="button" onClick={() => void searchMetadata()}>搜索 BGG</button>
      </div>
      <div className="board-game-cover-preview">
        {editor.imagePreview || editor.imageUrl
          ? <img alt="封面预览" src={editor.imagePreview || editor.imageUrl} />
          : <span className="board-game-cover-placeholder">暂无封面</span>}
      </div>
    </aside>
    <div className="game-editor-fields-pane">
      <section aria-labelledby="public-fields-title">
        <h3 id="public-fields-title">公开资料</h3>
        <label><span>中文名称</span><input value={editor.name} /></label>
      </section>
      <section aria-labelledby="store-fields-title">
        <h3 id="store-fields-title">本店配置</h3>
        <label><span>库存数量</span><input value={editor.quantity} /></label>
      </section>
    </div>
  </div>
  <footer className="modal-actions game-editor-actions">
    <button type="button" onClick={onCancel}>取消</button>
    <button className="primary-button" disabled={busy} type="submit">保存</button>
  </footer>
</form>
```

左栏固定 BGG 搜索/候选、`Powered by BGG`、来源 ID、优先 `imageUrl` 的大封面预览、本地上传和移除；右栏保留公开资料、本店配置和修改原因。

- [ ] **Step 6: 添加不受通用 modal 覆盖的 CSS**

```css
.modal-card.game-editor-shell {
  width: min(1180px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  padding: 0;
  overflow: hidden;
}

.game-editor-body {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  overflow: hidden;
}

.game-editor-source-pane,
.game-editor-fields-pane {
  overflow-y: auto;
}
```

标题和底部动作区保持可见；窄于 900px 时改为单列并允许整个正文滚动。删除旧 `.game-editor { width: min(900px, 100%); }`，避免双重来源。

- [ ] **Step 7: 运行编辑器测试与类型检查**

Run:

```powershell
pnpm.cmd exec vitest run apps/merchant-desktop/src/renderer/src/board-game-editor.test.ts apps/merchant-desktop/src/renderer/src/BoardGameEditorModal.test.tsx
pnpm.cmd --filter @zyapp/merchant-desktop typecheck
```

Expected: PASS；CSS 选择器 `.modal-card.game-editor-shell` 的特异性高于 `.modal-card`。

- [ ] **Step 8: 提交编辑器交互**

```powershell
git add apps/merchant-desktop/src/renderer/src/board-game-editor.ts apps/merchant-desktop/src/renderer/src/board-game-editor.test.ts apps/merchant-desktop/src/renderer/src/BoardGameEditorModal.tsx apps/merchant-desktop/src/renderer/src/BoardGameEditorModal.test.tsx apps/merchant-desktop/src/renderer/src/styles.css
git commit -m "feat: add wide board game editor with cover fallback"
```

### Task 7: 拆分公告与桌游页面并实现 A1 舒适单行列表

**Files:**
- Create: `apps/merchant-desktop/src/renderer/src/AnnouncementPage.tsx`
- Create: `apps/merchant-desktop/src/renderer/src/BoardGamePage.tsx`
- Create: `apps/merchant-desktop/src/renderer/src/BoardGamePage.test.tsx`
- Modify: `apps/merchant-desktop/src/renderer/src/AppShell.tsx:13-40,262-272,382-397`
- Modify: `apps/merchant-desktop/src/renderer/src/styles.css:3337-3427`
- Delete: `apps/merchant-desktop/src/renderer/src/ContentPage.tsx`

**Interfaces:**
- Consumes: `SessionUser`、`BoardGameSummary[]` 和现有 Desktop API。
- Produces: 独立“公告管理”“桌游管理”导航；桌游页支持关键词、状态、分类筛选及 A1 单行操作。

- [ ] **Step 1: 写入失败的筛选与 A1 行测试**

```tsx
expect(filterBoardGames(games, {
  query: '13',
  status: 'all',
  category: 'all'
})).toEqual([catan])

expect(filterBoardGames(games, {
  query: '',
  status: 'missing-pieces',
  category: '策略'
})).toEqual([damagedStrategyGame])

const html = renderToStaticMarkup(
  <BoardGameRow game={catan} cover={null} canManage canOperate onEdit={noop} onOperate={noop} onStatus={noop} />
)
expect(html).toContain('编辑资料')
expect(html).toContain('状态与备注')
expect(html).toContain('BGG #13')
expect(html).toContain('board-game-cover-placeholder')
```

状态测试覆盖 `active`、`disabled`、`available`、`sold-out`、`missing-pieces`、`private`、`recommended`、`customer-consigned`；关键词覆盖名称、分类和 BGG ID。

- [ ] **Step 2: 运行页面测试确认导出不存在**

Run:

```powershell
pnpm.cmd exec vitest run apps/merchant-desktop/src/renderer/src/BoardGamePage.test.tsx
```

Expected: FAIL，`BoardGamePage` / `filterBoardGames` / `BoardGameRow` 尚不存在。

- [ ] **Step 3: 提取公告页并删除旧 tab 状态和遗留注释**

把公告加载、编辑、发布/停用和确认 modal 原样迁入 `AnnouncementPage`；标题改为“公告管理”。不要复制桌游 state、handlers、Tab 或 `Legacy inline editor` 注释块。

- [ ] **Step 4: 实现桌游筛选模型**

```ts
export type BoardGameFilterStatus =
  | 'all' | 'active' | 'disabled' | 'available' | 'sold-out'
  | 'missing-pieces' | 'private' | 'recommended' | 'customer-consigned'

export function filterBoardGames(
  games: readonly BoardGameSummary[],
  filters: { query: string; status: BoardGameFilterStatus; category: string }
): BoardGameSummary[] {
  const query = filters.query.trim().toLowerCase()
  return games.filter((game) => {
    const queryMatches = !query ||
      game.name.toLowerCase().includes(query) ||
      game.categories.some((category) => category.toLowerCase().includes(query)) ||
      String(game.bggId ?? '').includes(query)
    const categoryMatches = filters.category === 'all' ||
      game.categories.includes(filters.category)
    const statusMatches = filters.status === 'all' ||
      (filters.status === 'active' && game.recordStatus === 'active') ||
      (filters.status === 'disabled' && game.recordStatus === 'disabled') ||
      (filters.status === 'available' && game.available) ||
      (filters.status === 'sold-out' && !game.available) ||
      (filters.status === 'missing-pieces' && game.missingPieces) ||
      (filters.status === 'private' && game.private) ||
      (filters.status === 'recommended' && game.recommended) ||
      (filters.status === 'customer-consigned' && game.customerConsigned)
    return queryMatches && categoryMatches && statusMatches
  })
}
```

分类选项从当前列表 `categories` 去重排序；工具栏显示总数、筛选后数量、关键词输入、状态 select、分类 select 和“新增桌游”。

- [ ] **Step 5: 实现约 100px 的 A1 单行**

顺序固定为 82px 封面/占位、名称+单行简介+分类、人数/时长/复杂度/内部数量、状态标签+BGG ID、右侧操作。无时长显示“时长待补充”；停用行降低视觉强调但操作仍可见。

```tsx
<article className={`board-game-row ${game.recordStatus}`}>
  <div className="board-game-row-cover">
    {cover
      ? <img alt={game.name} src={cover} />
      : <span className="board-game-cover-placeholder">暂无封面</span>}
  </div>
  <div className="board-game-row-summary">
    <h2>{game.name}</h2>
    <p>{game.introduction}</p>
    <div className="activity-tags">
      {game.categories.map((category) => <span key={category}>{category}</span>)}
    </div>
  </div>
  <div className="board-game-row-facts">
    <span>{game.minPlayers}-{game.maxPlayers} 人</span>
    <span>复杂度 {game.complexityRating?.toFixed(1) ?? '待补充'}</span>
    <span>内部数量 {game.quantity}</span>
  </div>
  <div className="board-game-row-statuses">
    <span>{game.available ? '可用' : '售罄'}</span>
    <span>{game.bggId ? `BGG #${game.bggId}` : '无 BGG ID'}</span>
  </div>
  <div className="board-game-row-actions">
    {canManage ? <button type="button" onClick={onEdit}>编辑资料</button> : null}
    {canOperate ? <button type="button" onClick={onOperate}>状态与备注</button> : null}
    {canManage ? <button type="button" onClick={onStatus}>启用/停用</button> : null}
  </div>
</article>
```

- [ ] **Step 6: 将缓存失败动作接入桌游页保存流程**

`saveBoardGame(editorOverride = gameEditor)` 捕获 `coverSource === 'bgg'` 的缓存错误后只设置 `coverCacheError`，不关闭 modal、不清空 editor/candidates。重试调用同一保存函数；上传本地图片清除错误并切为 `local`；“使用默认封面并保存”以 `{ imageUrl: '', localImagePath: '', imagePreview: '', coverSource: 'none' }` 的 editor override 立即重试。

- [ ] **Step 7: 更新 AppShell 独立导航**

```ts
type Page =
  | 'announcements'
  | 'board-games'
  // existing pages except 'content'
```

在原内容管理位置依次放“公告管理”（短名“告”）和“桌游管理”（短名“游”），两者都使用 `content.read` 可见性；对应渲染 `AnnouncementPage` 与 `BoardGamePage`。

- [ ] **Step 8: 实现 A1 和响应式 CSS**

桌面行最小高度约 100px、封面 82px；窗口变窄时先隐藏简介和次要标签，再压缩 facts，名称、封面、关键状态和操作始终可见。移除 `.board-game-grid` 的三列/两列卡片规则，不影响 `.content-card-grid` 公告卡片。

- [ ] **Step 9: 运行 renderer 测试、类型检查和构建**

Run:

```powershell
pnpm.cmd exec vitest run apps/merchant-desktop/src/renderer/src/board-game-editor.test.ts apps/merchant-desktop/src/renderer/src/BoardGameEditorModal.test.tsx apps/merchant-desktop/src/renderer/src/BoardGamePage.test.tsx
pnpm.cmd --filter @zyapp/merchant-desktop typecheck
pnpm.cmd --filter @zyapp/merchant-desktop build
```

Expected: PASS；构建中无旧 `ContentPage` import。

- [ ] **Step 10: 提交页面拆分**

```powershell
git add apps/merchant-desktop/src/renderer/src/AnnouncementPage.tsx apps/merchant-desktop/src/renderer/src/BoardGamePage.tsx apps/merchant-desktop/src/renderer/src/BoardGamePage.test.tsx apps/merchant-desktop/src/renderer/src/AppShell.tsx apps/merchant-desktop/src/renderer/src/styles.css
git rm apps/merchant-desktop/src/renderer/src/ContentPage.tsx
git commit -m "feat: add independent PC board game management"
```

### Task 8: 完整回归、安全扫描与本地人工验收

**Files:**
- Verify only: all files changed in Tasks 1-7
- Preserve: `apps/miniapp/src/pages/games/index.wxml`
- Preserve: `apps/miniapp/src/pages/games/index.wxss`
- Preserve: `apps/miniapp/scripts/board-game-library-layout.test.mjs`

**Interfaces:**
- Consumes: 完整实现与当前用户工作区。
- Produces: 可复现的自动化验证记录；不执行测试/生产部署。

- [ ] **Step 1: 运行桌游功能定向测试**

Run:

```powershell
pnpm.cmd exec vitest run packages/contracts/src/board-game-metadata.test.ts apps/api/src/board-game-metadata/bgg-xml.test.ts apps/api/src/board-game-metadata/bgg-adapter.test.ts apps/api/src/board-game-metadata/board-game-metadata.service.test.ts apps/api/src/board-game-metadata/board-game-metadata.controller.test.ts apps/api/src/board-game-metadata/board-game-metadata.wiring.test.ts apps/api/src/board-game-metadata/request-gate.test.ts apps/api/src/board-game-cover-cache.service.test.ts apps/api/src/board-game-cover.controller.test.ts apps/api/src/config.test.ts apps/merchant-desktop/src/main/cloud-sync-client.test.ts apps/merchant-desktop/src/main/board-game-cover-save.test.ts apps/merchant-desktop/src/renderer/src/board-game-editor.test.ts apps/merchant-desktop/src/renderer/src/BoardGameEditorModal.test.tsx apps/merchant-desktop/src/renderer/src/BoardGamePage.test.tsx
```

Expected: PASS。

- [ ] **Step 2: 运行跨端和领域回归**

Run:

```powershell
pnpm.cmd exec vitest run apps/api/src/board-game-library.test.ts apps/api/src/public-content.service.test.ts apps/merchant-desktop/src/main/board-game-image.test.ts
pnpm.cmd --filter @zyapp/miniapp test
```

Expected: PASS；小程序桌游库现有布局改动保持不变。

- [ ] **Step 3: 运行全仓类型、测试和构建**

Run:

```powershell
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
```

Expected: 全部 exit code 0。

- [ ] **Step 4: 检查安全边界和格式**

Run:

```powershell
git diff --check
rg -n "cf\.geekdo-images\.com" apps packages
rg -n "BGG_XML_API_TOKEN|Authorization:.*Bearer" apps/merchant-desktop/src/renderer apps/miniapp/src
```

Expected: `cf.geekdo-images.com` 仅出现在服务端允许列表和测试；renderer/小程序无 BGG Token 或设备 Bearer 读取代码；`git diff --check` 无输出。

- [ ] **Step 5: 启动 PC 做本地人工验收**

Run:

```powershell
pnpm.cmd --filter @zyapp/merchant-desktop dev
```

依次验证：独立“公告管理/桌游管理”导航；A1 单行字段与三类操作；中文名、英文名、BGG ID、BGG 链接各搜索一次；详情带入和 BGG 直链封面预览；宽版编辑器不被 460px modal 覆盖；缓存失败时三种恢复动作均保留表单；默认封面不写 URL。

- [ ] **Step 6: 核对未触碰用户现有改动**

Run:

```powershell
git status --short
git diff -- apps/miniapp/scripts/board-game-library-layout.test.mjs apps/miniapp/src/pages/games/index.wxml apps/miniapp/src/pages/games/index.wxss .gitignore
```

Expected: 上述文件仍只包含开始实施前已有的用户差异；`.tmp-games-layout.png`、zip 和部署备份文件仍未暂存。

- [ ] **Step 7: 提交仅在验证中发现的必要修正**

若 Step 1-6 发现并修复实现缺陷，只暂存对应源码与测试，然后执行：

```powershell
git commit -m "fix: complete board game cover cache verification"
```

若没有修正则不创建空提交。
