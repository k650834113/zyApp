# 小程序桌游库 Implementation Plan

> 执行记录（2026-08-02）：Task 1–8 已完成代码、文档和自动化验证；本机未发现微信开发者工具可执行程序，Mock 模拟器点击验收保留为人工闸门。计划中原标注为“Modify”的 `docs/正式需求基线-v2-PC优先.md` 在执行基线中不存在，因此本轮按已确认范围新建该增补基线文件。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改动 PC 端录入、PC SQLite 与桌游同步协议的前提下，交付正式小程序桌游库、服务端筛选、数字复杂度展示、云端点赞和“我喜欢的”页面。

**Architecture:** `@zyapp/contracts` 定义公开桌游筛选与点赞合同，PostgreSQL 迁移只增加可空 `complexity_rating` 和按门店隔离的点赞关系。NestJS 继续作为小程序唯一数据边界，统一完成实际可玩过滤、筛选、点赞聚合和身份校验；原生小程序通过共享卡片与范围滑块组件复用桌游库和收藏列表，Mock 客户端实现相同接口用于确定性验收。

**Tech Stack:** TypeScript 5.9、NestJS 11、PostgreSQL、Drizzle schema、Vitest、Node test、微信原生小程序 WXML/WXSS。

## Global Constraints

- 小程序只调用 NestJS API，不连接 PC SQLite 或 PostgreSQL。
- 本轮不修改 PC 桌游录入、PC SQLite schema、桌游 outbox 或同步物化协议。
- `complexityRating` 本轮为 `number | null`，合法非空值为 `0.0–5.0` 且最多一位小数；正式发布前必须补齐真实公开可玩桌游。
- 分类多选为 AND；人数要求桌游覆盖完整所选范围；时长为区间相交；复杂度为闭区间。
- 实际可玩必须同时满足：启用、公开、可玩、门店数量大于 0、无缺件。
- 点赞按 `(tenantId, storeId, boardGameId, viewerId)` 唯一；客户端提交目标 `liked` 状态和 8–100 字符的 `requestId`。
- 点赞只使用已有 `miniapp_identity.id`，不得创建虚假会员，也不得返回 OpenID 或内部查看者 ID。
- 金额、钱包、订单、支付、月卡、退款及其他财务链路均不改动。
- 正式构建继续拒绝开发身份、虚拟手机号和 Mock 数据；最终 `dist/` 恢复为 Mock 构建。

---

## File Structure

### Contracts and cloud persistence

- Modify `packages/contracts/src/index.ts`: 将公开桌游摘要改为数字复杂度与点赞字段，增加筛选、点赞请求和响应类型。
- Create `packages/cloud-db/migrations/0019_miniapp_board_game_library.sql`: 增加可空复杂度与小程序点赞关系。
- Modify `packages/cloud-db/src/schema.ts`: 与迁移保持一致的 Drizzle schema。
- Modify `packages/cloud-db/src/migrations.test.ts`: 锁定迁移 19 的编号和关键约束。

### NestJS API

- Create `apps/api/src/board-game-library.ts`: 纯输入校验与查询条件规范化。
- Create `apps/api/src/board-game-library.test.ts`: 筛选与点赞输入校验测试。
- Create `apps/api/src/board-game-like.service.ts`: 幂等设置点赞目标状态并返回权威总数。
- Create `apps/api/src/board-game-like.service.test.ts`: 点赞、取消、重复请求和不可玩校验测试。
- Create `apps/api/src/board-game-like.controller.ts`: 受微信会话保护的点赞和收藏列表路由。
- Create `apps/api/src/miniapp-optional-auth.guard.ts`: 公开列表缺少令牌时保持匿名，有有效令牌时附加查看者身份。
- Create `apps/api/src/miniapp-optional-auth.guard.test.ts`: 匿名、有令牌和无效令牌行为测试。
- Modify `apps/api/src/public-content.controller.ts`: 接收全部筛选参数和可选查看者身份。
- Modify `apps/api/src/public-content.service.ts`: 使用门店配置过滤实际可玩桌游，并聚合点赞。
- Modify `apps/api/src/public-content.service.test.ts`: 覆盖可玩范围、筛选语义、匿名/登录点赞状态和收藏查询。
- Modify `apps/api/src/app.module.ts`: 注册新增控制器、服务和 guard。

### Mini program client and view model

- Modify `apps/miniapp/src/services/types.ts`: 扩展 `MiniappClient` 桌游方法。
- Modify `apps/miniapp/src/services/http-client.ts`: 序列化筛选参数并调用列表、收藏和点赞路由。
- Modify `apps/miniapp/src/services/http-client.test.ts`: 锁定 URL、请求体、会话重试行为。
- Modify `apps/miniapp/src/services/mock-client.ts`: 提供完整 Mock 桌游、服务端同语义筛选和可持久到当前 Mock 生命周期的点赞状态。
- Modify `apps/miniapp/src/services/mock-client.test.ts`: 覆盖筛选、点赞和收藏。
- Create `apps/miniapp/src/services/board-game-library.ts`: 卡片文本、筛选默认值、查询清理和乐观点赞结果合并。
- Create `apps/miniapp/src/services/board-game-library.test.ts`: 纯视图模型和筛选状态测试。
- Create `apps/miniapp/src/services/range-values.ts`: 双端范围值归一化和坐标换算。
- Create `apps/miniapp/src/services/range-values.test.ts`: 端点不交叉、步长和边界测试。

### Mini program UI

- Create `apps/miniapp/src/components/board-game-card/index.{json,ts,wxml,wxss}`: 两页共用卡片、展开简介和独立点赞区域。
- Create `apps/miniapp/src/components/range-slider/index.{json,ts,wxml,wxss}`: 人数、时长、复杂度共用的双端拖拉条。
- Rewrite `apps/miniapp/src/pages/games/index.{json,ts,wxml,wxss}`: 正式桌游库、筛选面板、结果与错误状态。
- Create `apps/miniapp/src/pages/favorites/index.{json,ts,wxml,wxss}`: “我喜欢的”独立页面。
- Modify `apps/miniapp/src/pages/member/index.{ts,wxml,wxss}`: 保留资料编辑并增加“我喜欢的”入口及游客状态。
- Modify `apps/miniapp/src/pages/home/index.{ts,wxml}` and `apps/miniapp/src/pages/history/index.{ts,wxml}`: 四栏导航。
- Modify `apps/miniapp/src/app.json` and `apps/miniapp/src/app.wxss`: 批准两页并将导航改为四列。
- Modify `apps/miniapp/scripts/build-output.test.mjs`: 正式顾客构建批准 `games` 和 `favorites`。
- Create `apps/miniapp/scripts/board-game-library-layout.test.mjs`: 静态验证卡片复用、筛选控件和四栏导航。
- Modify `apps/miniapp/package.json`: 将新增测试加入 `miniapp:test`。

### Documentation

- Modify `docs/正式需求基线-v2-PC优先.md`: 记录桌游库本轮范围及 PC/同步延后边界。
- Modify `docs/开发任务路线图-v1.md`: 增加本轮任务、自动验收和后续真实数据闸门。

---

### Task 1: Freeze contracts and cloud schema

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Create: `packages/cloud-db/migrations/0019_miniapp_board_game_library.sql`
- Modify: `packages/cloud-db/src/schema.ts`
- Modify: `packages/cloud-db/src/migrations.test.ts`

**Interfaces:**

- Produces: `PublicBoardGameFilters`, `PublicBoardGameSummary`, `SetBoardGameLikeRequest`, `BoardGameLikeResult`.
- Produces: PostgreSQL `cloud_board_game.complexity_rating` and `miniapp_board_game_like`.
- Consumes: existing `Identifier`, `tenant`, `store`, `cloud_board_game`, and `miniapp_identity` identifiers.

- [ ] **Step 1: Update the migration test and contract typecheck expectations**

Change the migration tail assertion to require migration 19 and its invariants:

```ts
expect(migrations.slice(-3).map((migration) => migration.version)).toEqual([
  17, 18, 19
])
expect(migrations.at(-1)?.name).toBe('miniapp_board_game_library')
expect(migrations.at(-1)?.sql).toContain('complexity_rating NUMERIC(2,1)')
expect(migrations.at(-1)?.sql).toContain(
  'UNIQUE (tenant_id, store_id, board_game_id, viewer_id)'
)
```

Replace the old public DTO and add exact contracts:

```ts
export type PublicBoardGameFilters = {
  query?: string
  categories?: string[]
  minPlayers?: number
  maxPlayers?: number
  minMinutes?: number
  maxMinutes?: number
  minComplexity?: number
  maxComplexity?: number
}

export type PublicBoardGameSummary = {
  id: Identifier
  name: string
  introduction: string
  categories: string[]
  minPlayers: number
  maxPlayers: number
  minMinutes: number | null
  maxMinutes: number | null
  complexityRating: number | null
  imageUrl: string | null
  customerNote: string | null
  likeCount: number
  likedByViewer: boolean
}

export type SetBoardGameLikeRequest = {
  liked: boolean
  requestId: string
}

export type BoardGameLikeResult = {
  boardGameId: Identifier
  likedByViewer: boolean
  likeCount: number
}
```

- [ ] **Step 2: Run the focused migration test and typecheck to verify failure**

Run:

```powershell
corepack pnpm exec vitest run packages/cloud-db/src/migrations.test.ts
corepack pnpm --filter @zyapp/contracts typecheck
```

Expected: migration test fails because version 19 is absent; the isolated contracts typecheck passes after the new types are valid. Cross-package compile errors from callers still using `difficulty` and `soldOut` are resolved in Tasks 2 and 4.

- [ ] **Step 3: Add migration 19**

Create the migration with these exact constraints:

```sql
ALTER TABLE cloud_board_game
  ADD COLUMN complexity_rating NUMERIC(2,1);

ALTER TABLE cloud_board_game
  ADD CONSTRAINT ck_cloud_board_game_complexity_rating
  CHECK (
    complexity_rating IS NULL OR
    (complexity_rating >= 0.0 AND complexity_rating <= 5.0)
  );

CREATE TABLE miniapp_board_game_like (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  board_game_id UUID NOT NULL REFERENCES cloud_board_game(id),
  viewer_id UUID NOT NULL REFERENCES miniapp_identity(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, store_id, board_game_id, viewer_id)
);

CREATE INDEX idx_miniapp_board_game_like_game
  ON miniapp_board_game_like(tenant_id, store_id, board_game_id);

CREATE INDEX idx_miniapp_board_game_like_viewer
  ON miniapp_board_game_like(tenant_id, store_id, viewer_id, created_at DESC);
```

- [ ] **Step 4: Mirror migration 19 in Drizzle schema**

Import `numeric` from `drizzle-orm/pg-core`, add `complexityRating` to `cloudBoardGames`, and export the new table:

```ts
complexityRating: numeric('complexity_rating', {
  precision: 2,
  scale: 1,
  mode: 'number'
})
```

```ts
export const miniappBoardGameLikes = pgTable(
  'miniapp_board_game_like',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    boardGameId: uuid('board_game_id')
      .notNull()
      .references(() => cloudBoardGames.id),
    viewerId: uuid('viewer_id')
      .notNull()
      .references(() => miniappIdentities.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('uq_miniapp_board_game_like_viewer_game').on(
      table.tenantId,
      table.storeId,
      table.boardGameId,
      table.viewerId
    ),
    index('idx_miniapp_board_game_like_game').on(
      table.tenantId,
      table.storeId,
      table.boardGameId
    ),
    index('idx_miniapp_board_game_like_viewer').on(
      table.tenantId,
      table.storeId,
      table.viewerId,
      table.createdAt
    )
  ]
)
```

- [ ] **Step 5: Run focused verification**

Run:

```powershell
corepack pnpm exec vitest run packages/cloud-db/src/migrations.test.ts
corepack pnpm --filter @zyapp/cloud-db typecheck
corepack pnpm --filter @zyapp/contracts typecheck
```

Expected: migration and schema pass; contracts may still expose compile errors only in not-yet-migrated consumers, which Task 2 and Task 4 resolve.

- [ ] **Step 6: Commit the contract and persistence boundary**

```powershell
git add packages/contracts/src/index.ts packages/cloud-db/migrations/0019_miniapp_board_game_library.sql packages/cloud-db/src/schema.ts packages/cloud-db/src/migrations.test.ts
git commit -m "feat: add board game library contracts"
```

### Task 2: Implement validated playable-game queries

**Files:**

- Create: `apps/api/src/board-game-library.ts`
- Create: `apps/api/src/board-game-library.test.ts`
- Create: `apps/api/src/miniapp-optional-auth.guard.ts`
- Create: `apps/api/src/miniapp-optional-auth.guard.test.ts`
- Modify: `apps/api/src/public-content.controller.ts`
- Modify: `apps/api/src/public-content.service.ts`
- Modify: `apps/api/src/public-content.service.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**

- Consumes: `PublicBoardGameFilters`, optional `MiniappPrincipal.identityId`, store UUID.
- Produces: `normalizePublicBoardGameFilters(raw): PublicBoardGameFilters`.
- Produces: `PublicContentService.listGames(storeId, filters, viewerId, options)` and `listFavoriteGames(principal)`.

- [ ] **Step 1: Write failing input validation tests**

Cover array normalization, numeric bounds, one-decimal complexity and inverted ranges:

```ts
expect(
  normalizePublicBoardGameFilters({
    query: ' 策略 ',
    categories: ['德式', '策略'],
    minPlayers: '3',
    maxPlayers: '6',
    minComplexity: '1.2',
    maxComplexity: '3.5'
  })
).toEqual({
  query: '策略',
  categories: ['德式', '策略'],
  minPlayers: 3,
  maxPlayers: 6,
  minComplexity: 1.2,
  maxComplexity: 3.5
})

expect(() =>
  normalizePublicBoardGameFilters({ minPlayers: '6', maxPlayers: '3' })
).toThrow('人数范围')
expect(() =>
  normalizePublicBoardGameFilters({ minComplexity: '2.35' })
).toThrow('复杂度')
```

- [ ] **Step 2: Write failing service tests for all filter semantics**

Make the pool spy assert that generated SQL contains the authoritative predicates:

```ts
expect(sql).toContain("COALESCE(config.record_status, game.record_status) = 'active'")
expect(sql).toContain('COALESCE(config.private, game.private) = FALSE')
expect(sql).toContain('COALESCE(config.available, game.available) = TRUE')
expect(sql).toContain('COALESCE(config.quantity, game.quantity) > 0')
expect(sql).toContain('COALESCE(config.missing_pieces, game.missing_pieces) = FALSE')
expect(sql).toContain('game.categories_json @>')
expect(sql).toContain('game.min_players <=')
expect(sql).toContain('game.max_players >=')
expect(sql).toContain('COALESCE(game.max_minutes, game.min_minutes) >=')
expect(sql).toContain('game.complexity_rating BETWEEN')
```

Return a row with `complexity_rating: '2.3'`, `like_count: '7'`, and `liked_by_viewer: true`; expect `2.3`, `7`, and `true` as numbers/boolean in the DTO. Add a second call with `viewerId = null` and require `likedByViewer: false` while preserving `likeCount`.

- [ ] **Step 3: Run focused API tests to verify failure**

Run:

```powershell
corepack pnpm exec vitest run apps/api/src/board-game-library.test.ts apps/api/src/public-content.service.test.ts apps/api/src/miniapp-optional-auth.guard.test.ts
```

Expected: new modules are missing and the old query still returns unavailable games with enum difficulty.

- [ ] **Step 4: Implement strict query normalization**

Use this public signature and limits:

```ts
export function normalizePublicBoardGameFilters(
  raw: Record<string, unknown>
): PublicBoardGameFilters
```

- Trim query to at most 100 characters.
- Accept `categories` as a string or array, trim/deduplicate it, limit to 10 tags and 40 characters per tag.
- Player endpoints are integers from 1 through 100.
- Minute endpoints are integers from 1 through 1,440.
- Complexity endpoints are numbers from 0 through 5 with `value * 10` integral.
- Reject min greater than max for each range with `BadRequestException`.

- [ ] **Step 5: Implement optional miniapp authentication**

Use the bearer helper without requiring a token:

```ts
async canActivate(context: ExecutionContext): Promise<boolean> {
  const request = context.switchToHttp().getRequest<MiniappRequest>()
  const token = extractBearerToken(request.headers.authorization)
  if (!token) return true
  request.zyappMiniapp = await this.sessions.authenticate(token)
  return true
}
```

Tests must prove: no header does not call `authenticate`; valid header attaches the principal; invalid token propagates `UnauthorizedException` so the HTTP client can renew the session.

- [ ] **Step 6: Replace the public game query with current-store playable filtering**

Change the signature to:

```ts
async listGames(
  storeIdInput: string,
  filters: PublicBoardGameFilters = {},
  viewerId: string | null = null,
  options: { recommendedOnly?: boolean; favoriteOnly?: boolean } = {}
): Promise<PublicBoardGameSummary[]>
```

Build one parameterized query starting from `store current_store`, joining `cloud_board_game game` by tenant, and left joining `cloud_board_game_store_config config` by tenant/store/game. Apply the five playable predicates with `COALESCE(config.field, game.field)`; apply category JSON containment, complete player coverage, time overlap and complexity closed-range checks only when supplied. Use a lateral aggregate over `miniapp_board_game_like` to produce `like_count` and `liked_by_viewer`, and for `favoriteOnly` require an existing relation for the same viewer and current store.

Reject `favoriteOnly: true` when `viewerId` is null so a programming error cannot silently return an empty or cross-viewer list.

Order by store-level recommendation, then name:

```sql
ORDER BY COALESCE(config.recommended, game.recommended) DESC, game.name
LIMIT 100
```

Keep `getHome()` calling the same method with `{ recommendedOnly: true }` so home recommendations also exclude non-playable records.

- [ ] **Step 7: Wire the public controller**

Apply `MiniappOptionalAuthGuard` only to `GET /v1/public/games`, normalize `@Query()` once, and pass `request.zyappMiniapp?.identityId ?? null`. Keep `/public/home` and `/public/activities` behavior unchanged.

- [ ] **Step 8: Run API focused verification**

```powershell
corepack pnpm exec vitest run apps/api/src/board-game-library.test.ts apps/api/src/public-content.service.test.ts apps/api/src/miniapp-optional-auth.guard.test.ts
corepack pnpm --filter @zyapp/api typecheck
```

Expected: all focused tests and API typecheck pass.

- [ ] **Step 9: Commit playable queries**

```powershell
git add apps/api/src/board-game-library.ts apps/api/src/board-game-library.test.ts apps/api/src/miniapp-optional-auth.guard.ts apps/api/src/miniapp-optional-auth.guard.test.ts apps/api/src/public-content.controller.ts apps/api/src/public-content.service.ts apps/api/src/public-content.service.test.ts apps/api/src/app.module.ts
git commit -m "feat: filter playable board games"
```

### Task 3: Implement idempotent cloud likes and favorites API

**Files:**

- Create: `apps/api/src/board-game-like.service.ts`
- Create: `apps/api/src/board-game-like.service.test.ts`
- Create: `apps/api/src/board-game-like.controller.ts`
- Modify: `apps/api/src/board-game-library.ts`
- Modify: `apps/api/src/board-game-library.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**

- Consumes: authenticated `MiniappPrincipal`, board-game UUID, `SetBoardGameLikeRequest`.
- Produces: `BoardGameLikeService.setLiked(principal, gameId, rawInput): Promise<BoardGameLikeResult>`.
- Produces: `GET /v1/miniapp/favorite-games` and `PUT /v1/miniapp/board-games/:gameId/like`.

- [ ] **Step 1: Write failing like input and service tests**

Validate exact target state and request ID:

```ts
expect(normalizeSetBoardGameLikeRequest({
  liked: true,
  requestId: 'like-1700000000'
})).toEqual({ liked: true, requestId: 'like-1700000000' })
expect(() => normalizeSetBoardGameLikeRequest({ liked: 'yes' })).toThrow()
```

For `liked: true`, require test query order `BEGIN`, advisory transaction lock, playable-game check, `INSERT ... ON CONFLICT DO NOTHING`, authoritative aggregate, `COMMIT`. For `liked: false`, require `DELETE` scoped by all four identity columns and an unchanged zero result when repeated. Add rollback expectation when the game is not playable.

- [ ] **Step 2: Run focused tests to verify failure**

```powershell
corepack pnpm exec vitest run apps/api/src/board-game-library.test.ts apps/api/src/board-game-like.service.test.ts
```

Expected: missing validator and service failures.

- [ ] **Step 3: Implement target-state writes in one transaction**

Use a store/viewer/game advisory lock before checking and writing:

```sql
SELECT pg_advisory_xact_lock(
  hashtextextended($1 || ':' || $2 || ':' || $3, 0)
)
```

Confirm the requested game currently satisfies the same store-scoped playable predicates as Task 2. Insert with a server-generated UUID and `ON CONFLICT (tenant_id, store_id, board_game_id, viewer_id) DO NOTHING`, or delete with the same four-column scope. Then query:

```sql
SELECT COUNT(*)::integer AS like_count,
       BOOL_OR(viewer_id = $4)::boolean AS liked_by_viewer
FROM miniapp_board_game_like
WHERE tenant_id = $1 AND store_id = $2 AND board_game_id = $3
```

Return `false` for a null `BOOL_OR`. Do not store or return `providerSubject`, OpenID, or member ID.

- [ ] **Step 4: Add guarded controller routes**

```ts
@Controller('miniapp')
@UseGuards(MiniappAuthGuard)
export class BoardGameLikeController {
  @Get('favorite-games')
  favoriteGames(@Req() request: MiniappRequest) {
    return this.publicContent.listFavoriteGames(principal(request))
  }

  @Put('board-games/:gameId/like')
  setLiked(
    @Req() request: MiniappRequest,
    @Param('gameId') gameId: string,
    @Body() body: unknown
  ) {
    return this.likes.setLiked(principal(request), gameId, body)
  }
}
```

Use a local `principal()` helper that throws if the guard did not attach the identity. `listFavoriteGames()` calls Task 2 with `{ favoriteOnly: true }` and the current `identityId`.

- [ ] **Step 5: Run API tests and typecheck**

```powershell
corepack pnpm exec vitest run apps/api/src/board-game-library.test.ts apps/api/src/board-game-like.service.test.ts apps/api/src/public-content.service.test.ts
corepack pnpm --filter @zyapp/api typecheck
```

Expected: target-state writes are idempotent and favorite reads only expose currently playable games.

- [ ] **Step 6: Commit cloud likes**

```powershell
git add apps/api/src/board-game-like.service.ts apps/api/src/board-game-like.service.test.ts apps/api/src/board-game-like.controller.ts apps/api/src/board-game-library.ts apps/api/src/board-game-library.test.ts apps/api/src/app.module.ts
git commit -m "feat: add board game likes api"
```

### Task 4: Extend HTTP and Mock miniapp clients

**Files:**

- Modify: `apps/miniapp/src/services/types.ts`
- Modify: `apps/miniapp/src/services/http-client.ts`
- Modify: `apps/miniapp/src/services/http-client.test.ts`
- Modify: `apps/miniapp/src/services/mock-client.ts`
- Modify: `apps/miniapp/src/services/mock-client.test.ts`
- Create: `apps/miniapp/src/services/board-game-library.ts`
- Create: `apps/miniapp/src/services/board-game-library.test.ts`

**Interfaces:**

- Consumes: Task 1 contract types and existing automatic miniapp session creation.
- Produces: `listGames(filters?)`, `listFavoriteGames()`, and `setGameLiked(gameId, input)` on both clients.
- Produces: pure `toBoardGameCardView`, `withLikeResult`, `matchesBoardGameFilters`, and `cleanBoardGameFilters` helpers.

- [ ] **Step 1: Write failing HTTP client tests**

Assert AND categories use repeated query parameters and numeric filters are preserved:

```ts
await client.listGames({
  query: '宝石',
  categories: ['德式', '策略'],
  minPlayers: 3,
  maxPlayers: 6,
  minMinutes: 30,
  maxMinutes: 120,
  minComplexity: 1.5,
  maxComplexity: 3.5
})
expect(request.url).toContain('categories=%E5%BE%B7%E5%BC%8F')
expect(request.url).toContain('categories=%E7%AD%96%E7%95%A5')
expect(request.url).toContain('minPlayers=3')
expect(request.url).toContain('maxComplexity=3.5')
```

Assert favorites call `GET /v1/miniapp/favorite-games`, and like calls `PUT /v1/miniapp/board-games/{id}/like` with `{ liked, requestId }`. Keep the existing 401 clear-token/recreate-session/retry expectation.

- [ ] **Step 2: Write failing Mock behavior tests**

Cover all semantics with named data including “璀璨宝石” tagged `['德式', '策略', '竞争']`. Assert unavailable/private/zero-quantity/missing-piece games never appear; `3–6` player filters require full coverage; time uses overlap; null complexity is excluded only when complexity filtering is active. Assert repeated `liked: true` changes count once and `listFavoriteGames()` contains the game until `liked: false`.

- [ ] **Step 3: Run client tests to verify failure**

```powershell
corepack pnpm exec vitest run apps/miniapp/src/services/http-client.test.ts apps/miniapp/src/services/mock-client.test.ts apps/miniapp/src/services/board-game-library.test.ts
```

Expected: interface methods and new helpers are absent.

- [ ] **Step 4: Update the client interface and HTTP serialization**

```ts
listGames(filters?: PublicBoardGameFilters): Promise<PublicBoardGameSummary[]>
listFavoriteGames(): Promise<PublicBoardGameSummary[]>
setGameLiked(
  gameId: string,
  input: SetBoardGameLikeRequest
): Promise<BoardGameLikeResult>
```

Use `URLSearchParams`-equivalent manual pairs because the mini program runtime must not depend on browser globals. Always include `storeId`; append one `categories` pair per tag; append only defined scalar values.

- [ ] **Step 5: Implement reusable view-model helpers**

```ts
export type BoardGameCardView = PublicBoardGameSummary & {
  playersText: string
  durationText: string
  complexityText: string
  expanded: boolean
  likeBusy: boolean
  imageFailed: boolean
}

export function toBoardGameCardView(
  game: PublicBoardGameSummary,
  state: Partial<Pick<BoardGameCardView, 'expanded' | 'likeBusy' | 'imageFailed'>> = {}
): BoardGameCardView

export function withLikeResult(
  games: BoardGameCardView[],
  result: BoardGameLikeResult
): BoardGameCardView[]
```

Formatting is fixed: players `2–4 人`, duration `30–45 分钟` or `时长待补充`, complexity `复杂度 2.3/5` or `复杂度待补充`.

- [ ] **Step 6: Implement stateful Mock likes and server-equivalent filtering**

Keep a `Set<string>` for the current Mock viewer and mutable per-game counts. Return copies, never shared mutable objects. `setGameLiked()` applies the requested state, increments/decrements at most once, and returns the same authoritative shape as HTTP. Do not expose Mock-only availability fields through `PublicBoardGameSummary`.

- [ ] **Step 7: Run focused miniapp tests and typecheck**

```powershell
corepack pnpm exec vitest run apps/miniapp/src/services/http-client.test.ts apps/miniapp/src/services/mock-client.test.ts apps/miniapp/src/services/board-game-library.test.ts
corepack pnpm miniapp:typecheck
```

Expected: both client implementations satisfy one interface and all filter/like tests pass.

- [ ] **Step 8: Commit miniapp data clients**

```powershell
git add apps/miniapp/src/services/types.ts apps/miniapp/src/services/http-client.ts apps/miniapp/src/services/http-client.test.ts apps/miniapp/src/services/mock-client.ts apps/miniapp/src/services/mock-client.test.ts apps/miniapp/src/services/board-game-library.ts apps/miniapp/src/services/board-game-library.test.ts
git commit -m "feat: add miniapp board game clients"
```

### Task 5: Build reusable range slider and board-game card

**Files:**

- Create: `apps/miniapp/src/services/range-values.ts`
- Create: `apps/miniapp/src/services/range-values.test.ts`
- Create: `apps/miniapp/src/components/range-slider/index.json`
- Create: `apps/miniapp/src/components/range-slider/index.ts`
- Create: `apps/miniapp/src/components/range-slider/index.wxml`
- Create: `apps/miniapp/src/components/range-slider/index.wxss`
- Create: `apps/miniapp/src/components/board-game-card/index.json`
- Create: `apps/miniapp/src/components/board-game-card/index.ts`
- Create: `apps/miniapp/src/components/board-game-card/index.wxml`
- Create: `apps/miniapp/src/components/board-game-card/index.wxss`

**Interfaces:**

- Produces: `<range-slider min max step lower upper unit bindchange>`.
- Produces: `<board-game-card game bindtoggle bindlike>` with non-bubbling independent heart action.
- Consumes: `BoardGameCardView` from Task 4.

- [ ] **Step 1: Write failing range utility tests**

```ts
expect(normalizeRange({ min: 1, max: 12, step: 1, lower: 8, upper: 3 }))
  .toEqual({ lower: 3, upper: 8 })
expect(valueFromPosition({ x: 75, left: 0, width: 100, min: 0, max: 5, step: 0.1 }))
  .toBe(3.8)
expect(valueFromPosition({ x: -20, left: 0, width: 100, min: 1, max: 10, step: 1 }))
  .toBe(1)
```

- [ ] **Step 2: Run the utility test to verify failure**

```powershell
corepack pnpm exec vitest run apps/miniapp/src/services/range-values.test.ts
```

Expected: module missing.

- [ ] **Step 3: Implement deterministic range math**

Export `normalizeRange`, `valueFromPosition`, and `nearestHandle`. Clamp before rounding, round by the decimal precision of `step`, and never allow lower above upper. When both handles are equally near, preserve the last active handle.

- [ ] **Step 4: Implement the custom two-handle component**

The component queries `.range-track` bounds on `touchstart`, chooses the nearest handle, maps `changedTouches[0].clientX` through `valueFromPosition` on `touchmove`, and triggers:

```ts
this.triggerEvent('change', {
  lower: next.lower,
  upper: next.upper
})
```

WXML must render readable values above the track, a filled interval, and two circular handles. Add `aria-role="slider"`, `aria-valuemin`, `aria-valuemax`, and the current value on each handle. The component must work with steps `1`, `5`, and `0.1`.

- [ ] **Step 5: Implement the shared card component**

Use two separate handlers:

```ts
methods: {
  toggle() {
    this.triggerEvent('toggle', { gameId: this.data.game.id })
  },
  like() {
    if (this.data.game.likeBusy) return
    this.triggerEvent('like', { gameId: this.data.game.id })
  },
  imageError() {
    this.triggerEvent('imageerror', { gameId: this.data.game.id })
  }
}
```

Bind the card body to `toggle` and the heart button directly to `like`; do not wrap the heart inside the body tap target. Render tags on their own row, then `playersText · durationText · complexityText` on one metadata row. Render introduction only when `game.expanded`, and use a CSS placeholder when the image URL is null or failed.

- [ ] **Step 6: Run component utility tests and typecheck**

```powershell
corepack pnpm exec vitest run apps/miniapp/src/services/range-values.test.ts apps/miniapp/src/services/board-game-library.test.ts
corepack pnpm miniapp:typecheck
```

Expected: range math and component TypeScript pass.

- [ ] **Step 7: Commit reusable components**

```powershell
git add apps/miniapp/src/services/range-values.ts apps/miniapp/src/services/range-values.test.ts apps/miniapp/src/components/range-slider apps/miniapp/src/components/board-game-card
git commit -m "feat: add board game ui components"
```

### Task 6: Implement the formal board-game library page

**Files:**

- Rewrite: `apps/miniapp/src/pages/games/index.json`
- Rewrite: `apps/miniapp/src/pages/games/index.ts`
- Rewrite: `apps/miniapp/src/pages/games/index.wxml`
- Rewrite: `apps/miniapp/src/pages/games/index.wxss`
- Create: `apps/miniapp/scripts/board-game-library-layout.test.mjs`
- Modify: `apps/miniapp/package.json`

**Interfaces:**

- Consumes: Task 4 client/view helpers and Task 5 components.
- Produces: one first-level page with search, draft/applied filters, result count, expandable cards, optimistic likes and four-column navigation.

- [ ] **Step 1: Write the failing layout assertions**

Read page and component source and require:

```js
assert.match(gamesWxml, /placeholder="搜索桌游名称或分类"/)
assert.match(gamesWxml, /<range-slider[^>]+bindchange="changePlayers"/s)
assert.match(gamesWxml, /<range-slider[^>]+bindchange="changeMinutes"/s)
assert.match(gamesWxml, /<range-slider[^>]+bindchange="changeComplexity"/s)
assert.match(gamesWxml, /<board-game-card/)
assert.match(gamesWxml, /查看 {{previewCount}} 款桌游/)
assert.match(cardWxml, /{{game.playersText}} · {{game.durationText}} · {{game.complexityText}}/)
assert.match(cardWxml, /{{game.likedByViewer \? '♥' : '♡'}}/)
```

Add the script to `miniapp:test` beside the existing Node layout tests.

- [ ] **Step 2: Run the layout test to verify failure**

```powershell
corepack pnpm --filter @zyapp/miniapp exec node --test scripts/board-game-library-layout.test.mjs
```

Expected: old games page lacks the approved design.

- [ ] **Step 3: Implement page state and request sequencing**

Track these values:

```ts
data: {
  query: '',
  games: [] as BoardGameCardView[],
  loading: true,
  loadFailed: false,
  filterOpen: false,
  appliedFilters: {} as PublicBoardGameFilters,
  draftFilters: {} as PublicBoardGameFilters,
  categoryOptions: [] as string[],
  previewCount: 0,
  previewLoading: false
}
```

Use an incrementing request sequence for list and preview requests; ignore a response if a newer request started. On failure retain existing `games`, set `loadFailed`, and show retry. On first successful unfiltered load derive stable category options and numeric slider limits from the returned playable data. Debounce preview requests by 200 ms; applying filters copies the draft, closes the sheet, and uses the already returned preview list when its sequence is current.

- [ ] **Step 4: Implement search, chips and filter sheet**

- Search submits `query` with the applied filters.
- Category checkbox changes update a deduplicated array.
- Player range uses full coverage values.
- Duration and complexity use the range components.
- “清空” resets draft and applied filters while preserving the search query only if the user has not tapped the global clear chip.
- Applied filter chips remove one category or one whole numeric range and immediately reload.
- Empty state text is exactly“没有找到符合条件的桌游”。

- [ ] **Step 5: Implement expansion and optimistic likes**

Keep expansion per card so multiple cards can remain open. For heart taps:

1. Snapshot `likedByViewer` and `likeCount`.
2. Immediately set the target state and count locally; mark only this card busy.
3. Call `setGameLiked(gameId, { liked: target, requestId: requestId('board-game-like') })`.
4. Replace local values with the authoritative response.
5. On failure restore the snapshot and show“操作失败，请重试”。

- [ ] **Step 6: Implement WXML/WXSS and page configuration**

Set `navigationBarTitleText` to“桌游库” and register both components. Follow the confirmed warm cream/deep green card style. The bottom sheet includes a scrim, safe-area padding, visible numeric values and a fixed action row; it must scroll independently on short screens. Cards must not show sold-out or exact inventory copy because the API has already hidden non-playable games.

- [ ] **Step 7: Run the page tests, typecheck and Mock build**

```powershell
corepack pnpm --filter @zyapp/miniapp exec node --test scripts/board-game-library-layout.test.mjs
corepack pnpm miniapp:typecheck
corepack pnpm miniapp:build
```

Expected: layout assertions, typecheck and Mock build pass.

- [ ] **Step 8: Commit the library page**

```powershell
git add apps/miniapp/src/pages/games apps/miniapp/scripts/board-game-library-layout.test.mjs apps/miniapp/package.json
git commit -m "feat: build miniapp board game library"
```

### Task 7: Add favorites, My entry and four-column navigation

**Files:**

- Create: `apps/miniapp/src/pages/favorites/index.json`
- Create: `apps/miniapp/src/pages/favorites/index.ts`
- Create: `apps/miniapp/src/pages/favorites/index.wxml`
- Create: `apps/miniapp/src/pages/favorites/index.wxss`
- Modify: `apps/miniapp/src/pages/member/index.ts`
- Modify: `apps/miniapp/src/pages/member/index.wxml`
- Modify: `apps/miniapp/src/pages/member/index.wxss`
- Modify: `apps/miniapp/src/pages/home/index.ts`
- Modify: `apps/miniapp/src/pages/home/index.wxml`
- Modify: `apps/miniapp/src/pages/history/index.ts`
- Modify: `apps/miniapp/src/pages/history/index.wxml`
- Modify: `apps/miniapp/src/app.json`
- Modify: `apps/miniapp/src/app.wxss`
- Modify: `apps/miniapp/scripts/build-output.test.mjs`
- Modify: `apps/miniapp/scripts/board-game-library-layout.test.mjs`

**Interfaces:**

- Consumes: shared card and client methods.
- Produces: `/pages/favorites/index`, “我的”入口 and first-level navigation `首页 / 桌游库 / 明细 / 我的`.

- [ ] **Step 1: Extend failing build and layout tests**

Expected production customer page directories become:

```js
assert.deepEqual(pageDirectories, [
  'favorites',
  'games',
  'history',
  'home',
  'member'
])
```

Require every first-level WXML to contain the labels in order, require member WXML to contain“我喜欢的” and `已收藏 {{favoriteCount}} 款桌游`, and require favorites WXML to use `<board-game-card>`.

- [ ] **Step 2: Run tests to verify failure**

```powershell
corepack pnpm --filter @zyapp/miniapp exec node --test scripts/build-output.test.mjs scripts/board-game-library-layout.test.mjs
```

Expected: manifest and three-column navigation assertions fail.

- [ ] **Step 3: Implement the favorites page**

Load on every `onShow()` so state is refreshed after returning from the library. Reuse `toBoardGameCardView`; allow multiple expanded cards. A successful unlike removes the card from the array immediately after applying the authoritative response. The zero-card state is exactly“还没有喜欢的桌游，去桌游库逛逛吧”，with a button using `wx.reLaunch({ url: '/pages/games/index' })`.

- [ ] **Step 4: Add the My entry without requiring member registration**

On member page `onShow`, request `getMemberSummary()` and `listFavoriteGames()` together. In edit mode, a null member no longer redirects; show a compact guest profile prompt and still show the favorites entry. In complete-onboarding mode, preserve the existing redirect behavior if member data is absent. Add:

```ts
goFavorites() {
  wx.navigateTo({ url: '/pages/favorites/index' })
}
```

Place the new entry between account/profile content and the save action for members; for lightweight viewers place it below the guest profile prompt.

- [ ] **Step 5: Convert all first-level navigation to four columns**

Add `goGames()` using `wx.reLaunch({ url: '/pages/games/index' })` to home/history/member. Add `goHome`, `goHistory`, and `goProfile` to games. Change `.bottom-nav` to `grid-template-columns: repeat(4, 1fr)` and keep the active item per page. Use the exact order `首页 / 桌游库 / 明细 / 我的`.

- [ ] **Step 6: Approve pages in the formal manifest and release test**

Set manifest pages in this order:

```json
[
  "pages/home/index",
  "pages/games/index",
  "pages/history/index",
  "pages/member/index",
  "pages/favorites/index"
]
```

The existing customer-only filter continues removing only employee pages; the updated build-output test proves both new customer pages survive production filtering.

- [ ] **Step 7: Run full miniapp verification**

```powershell
corepack pnpm miniapp:typecheck
corepack pnpm miniapp:test
corepack pnpm miniapp:build
```

Expected: all miniapp tests pass and Mock `dist/app.json` contains five customer pages.

- [ ] **Step 8: Commit favorites and navigation**

```powershell
git add apps/miniapp/src/pages/favorites apps/miniapp/src/pages/member apps/miniapp/src/pages/home/index.ts apps/miniapp/src/pages/home/index.wxml apps/miniapp/src/pages/history/index.ts apps/miniapp/src/pages/history/index.wxml apps/miniapp/src/app.json apps/miniapp/src/app.wxss apps/miniapp/scripts/build-output.test.mjs apps/miniapp/scripts/board-game-library-layout.test.mjs
git commit -m "feat: add favorite board games page"
```

### Task 8: Record scope, run repository verification, and inspect the UI

**Files:**

- Modify: `docs/正式需求基线-v2-PC优先.md`
- Modify: `docs/开发任务路线图-v1.md`
- Verify: `docs/superpowers/specs/2026-08-01-miniapp-board-game-library-design.md`

**Interfaces:**

- Consumes: all prior tasks.
- Produces: authoritative scope record and evidence for API/Mock readiness.

- [ ] **Step 1: Update authoritative documentation**

Add a dated decision stating:

- This iteration delivers only cloud complexity storage, cloud likes, API filtering and the two miniapp pages.
- PC input, PC SQLite, desktop-cloud sync and real complexity backfill remain a later task.
- Production rollout is blocked until all public playable games have validated complexity values and the owner completes true-device acceptance.

Add a roadmap row for the implemented feature with separate statuses for automated completion and real-data/device gates.

- [ ] **Step 2: Run migration, API and contract verification**

```powershell
corepack pnpm exec vitest run packages/cloud-db/src/migrations.test.ts apps/api/src/board-game-library.test.ts apps/api/src/public-content.service.test.ts apps/api/src/board-game-like.service.test.ts apps/api/src/miniapp-optional-auth.guard.test.ts
corepack pnpm --filter @zyapp/contracts typecheck
corepack pnpm --filter @zyapp/cloud-db typecheck
corepack pnpm --filter @zyapp/api typecheck
```

Expected: all focused tests and all three typechecks pass.

- [ ] **Step 3: Run the required miniapp verification floor**

```powershell
corepack pnpm miniapp:typecheck
corepack pnpm miniapp:test
corepack pnpm miniapp:build
```

Expected: all pass and final output reports `[miniapp] built mock mode`.

- [ ] **Step 4: Run broader workspace regression tests**

```powershell
corepack pnpm test
```

Expected: workspace release-contract and Vitest suites pass. If an unrelated pre-existing failure occurs, record the exact command, test name and unchanged file evidence before proceeding.

- [ ] **Step 5: Inspect the built page in the simulator when tooling is available**

Import or refresh `apps/miniapp/dist`, navigate to `/pages/games/index`, and capture page state, console and screenshot. Verify search, category multi-select, all three dual-handle sliders, multi-card expansion, like/unlike, favorites removal, empty state and four-column nav using actual page actions. Label this as Mock simulator verification; do not call it real WeChat or production acceptance.

- [ ] **Step 6: Restore and verify final Mock artifact**

```powershell
$env:ZYAPP_MINIAPP_MODE='mock'
corepack pnpm miniapp:build
Remove-Item Env:ZYAPP_MINIAPP_MODE
```

Expected: final `dist` is Mock and contains the five approved customer pages.

- [ ] **Step 7: Check scope and commit documentation**

```powershell
git status --short
git diff --check
git diff -- docs/正式需求基线-v2-PC优先.md docs/开发任务路线图-v1.md docs/superpowers/specs/2026-08-01-miniapp-board-game-library-design.md
git add -f docs/正式需求基线-v2-PC优先.md docs/开发任务路线图-v1.md docs/superpowers/specs/2026-08-01-miniapp-board-game-library-design.md docs/superpowers/plans/2026-08-01-miniapp-board-game-library.md
git commit -m "docs: record board game library delivery"
```

Only the listed documentation may be staged in this step; keep `.superpowers/` and `infra/deploy/production.env.before-domain-20260725` untracked and untouched.

- [ ] **Step 8: Final handoff**

Report automated commands and simulator evidence separately. Explicitly list the remaining owner gates: real complexity entry/backfill, PC/sync iteration, test API migration deployment, experience-build verification, true-device verification and production release approval.
