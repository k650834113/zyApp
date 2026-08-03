# PC Board Game Entry and BGG Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fast PC board-game entry flow that imports licensed BGG metadata through the ZyApp server, saves one authoritative board-game master, and exposes the same confirmed Chinese fields and numeric complexity to the mini-program.

**Architecture:** The desktop renderer calls named preload IPC methods; Electron main uses the existing device-authenticated cloud client; NestJS owns BGG authorization, XML parsing, Redis caching and rate limiting. Confirmed records continue through the existing SQLite transaction, audit/outbox, cloud projection and `PublicBoardGameSummary` path, while manual entry remains available when BGG is disabled or unreachable.

**Tech Stack:** TypeScript 5.9, React 19, Electron 42, Node 24 `node:sqlite`, NestJS 11, PostgreSQL/Drizzle, Redis/ioredis, `fast-xml-parser`, Vitest 4, native WeChat Mini Program.

## Global Constraints

- Preserve the user's existing uncommitted mini-program changes in `apps/miniapp/scripts/board-game-library-layout.test.mjs`, `apps/miniapp/src/pages/games/index.wxml`, and `apps/miniapp/src/pages/games/index.wxss`; inspect and patch around them.
- Keep renderer access behind named preload IPC; renderer code must not call BGG, read SQLite, read arbitrary files, or receive the BGG Token.
- Store SQLite complexity as integer tenths `0..50`; expose it across TypeScript contracts as `number | null` in the range `0.0..5.0` with at most one decimal place.
- Keep `difficulty` only as a deprecated compatibility projection; derive it from complexity and never render it in the new PC or mini-program flow.
- Require complexity for a newly saved record when `private === false`, `available === true`, and `quantity > 0`; migrated records remain nullable until edited or published.
- Keep the shared board-game master tenant-scoped and store quantity/visibility/operational state in `board_game_store_config`.
- Reject duplicate non-null `bggId` values within one tenant; never auto-merge or delete existing records.
- Never request, cache, persist, translate, summarize, or expose BGG descriptions, comments, user data, collections, or forum data.
- Make BGG integration disabled by default. Real requests require `BGG_METADATA_MODE=xmlapi`, a server-only Token file, and approved commercial licensing.
- Keep BGG images disabled by default; return image URLs only when `BGG_PUBLIC_IMAGES_ENABLED=true` after written permission.
- Use only `https://boardgamegeek.com/xmlapi2/search` and `https://boardgamegeek.com/xmlapi2/thing`; reject client-supplied upstream URLs.
- Cache normalized searches for 24 hours and details for 7 days. If Redis is unavailable, do not bypass the shared request gate.
- Preserve manual entry and local outbox writes when BGG or the ZyApp cloud API is unavailable.
- Final local writes must keep board-game master, store config, audit and outbox in one SQLite transaction.
- Do not deploy or enable production BGG access during implementation; production activation requires the approved license and Token supplied later by the user.

---

## File Structure

- `packages/contracts/src/index.ts`: shared board-game metadata DTOs, saved source fields, public attribution, IPC channel names and desktop API methods.
- `packages/local-db/src/migrations.ts`: SQLite schema version 30 with integer-tenths complexity, provenance columns and tenant/BGG uniqueness.
- `packages/local-db/src/board-game.ts`: validation, compatibility difficulty derivation and transactional persistence.
- `packages/cloud-db/migrations/0020_board_game_metadata_import.sql`: cloud provenance columns and tenant/BGG unique index.
- `packages/cloud-db/src/schema.ts`: Drizzle mirror of migration 20.
- `packages/cloud-db/src/sync-operation-handler.ts`: strict projection parsing and PostgreSQL upsert.
- `packages/local-db/src/cloud-mirror-materialization.ts` and `packages/local-db/src/inbound-sync.ts`: cloud-to-SQLite field materialization.
- `apps/api/src/board-game-metadata/bgg-xml.ts`: pure XML-to-contract parsing.
- `apps/api/src/board-game-metadata/category-map.ts`: explicit BGG label to ZyApp Chinese category mapping.
- `apps/api/src/board-game-metadata/bgg-adapter.ts`: fixed-host authenticated BGG HTTP client.
- `apps/api/src/board-game-metadata/request-gate.ts`: Redis cache and cross-instance five-second start gate.
- `apps/api/src/board-game-metadata/board-game-metadata.service.ts`: manager authorization, normalization and stable errors.
- `apps/api/src/board-game-metadata/board-game-metadata.controller.ts`: device-authenticated status/search/details endpoints.
- `apps/merchant-desktop/src/main/cloud-sync-client.ts`: device-authenticated metadata HTTP calls.
- `apps/merchant-desktop/src/main/index.ts` and `apps/merchant-desktop/src/preload/index.ts`: permission-checked IPC bridge.
- `apps/merchant-desktop/src/renderer/src/board-game-editor.ts`: pure editor conversion, BGG input parsing and candidate application.
- `apps/merchant-desktop/src/renderer/src/BoardGameEditorModal.tsx`: focused quick-entry UI.
- `apps/merchant-desktop/src/renderer/src/ContentPage.tsx`: owns modal state and list refresh only.
- `apps/api/src/public-content.service.ts`: safe BGG attribution generated from internal provenance.
- `apps/miniapp/src/pages/games/*`: one result-footer attribution control without exposing internal source fields.

---

### Task 1: Define Shared Metadata, Persistence and IPC Contracts

**Files:**
- Modify: `packages/contracts/src/index.ts:765-870`
- Modify: `packages/contracts/src/index.ts:1191-1218`
- Modify: `packages/contracts/src/index.ts:2021-2027`
- Modify: `packages/contracts/src/index.ts:2158-2170`
- Create: `packages/contracts/src/board-game-metadata.test.ts`

**Interfaces:**
- Consumes: existing `Identifier`, `BoardGameSummary`, `SaveBoardGameFields`, `IPC_CHANNELS`, and `DesktopApi`.
- Produces: `BoardGameMetadataAvailability`, `BoardGameMetadataCandidate`, `BoardGameMetadataDetails`, `BoardGameMetadataDetailsRequest`, `BoardGameSourceAttribution`, extended board-game records, and three desktop API methods.

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  BoardGameMetadataDetails,
  BoardGameSummary,
  PublicBoardGameSummary,
  SaveBoardGameFields
} from './index'

describe('board-game metadata contracts', () => {
  it('carries numeric complexity, provenance and safe public attribution', () => {
    const details = {
      source: 'bgg', externalId: '13', primaryName: 'Catan',
      alternateNames: ['卡坦岛'], yearPublished: 1995,
      minPlayers: 3, maxPlayers: 4, minMinutes: 60, maxMinutes: 120,
      complexityRating: 2.3, categories: ['经济'], mechanics: ['交易'],
      thumbnailUrl: null, imageUrl: null,
      sourceUrl: 'https://boardgamegeek.com/boardgame/13',
      fetchedAt: '2026-08-03T00:00:00.000Z'
    } satisfies BoardGameMetadataDetails
    const saved = {
      name: '卡坦岛', introduction: '通过交易和建设发展岛屿。',
      categories: ['经济'], minPlayers: 3, maxPlayers: 4,
      minMinutes: 60, maxMinutes: 120, complexityRating: 2.3,
      quantity: 1, available: true, customerConsigned: false,
      missingPieces: false, private: false, recommended: true,
      bggId: 13, metadataSource: 'bgg',
      metadataImportedAt: '2026-08-03T00:00:00.000Z', missingParts: []
    } satisfies SaveBoardGameFields
    expect(details.externalId).toBe(String(saved.bggId))
    expectTypeOf<BoardGameSummary>().toHaveProperty('complexityRating')
    expectTypeOf<PublicBoardGameSummary>().toHaveProperty('sourceAttribution')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm exec vitest run packages/contracts/src/board-game-metadata.test.ts`

Expected: FAIL because the metadata and attribution types do not exist and `SaveBoardGameFields` still requires `difficulty`.

- [ ] **Step 3: Add the exact shared types**

```ts
export type BoardGameMetadataSource = 'bgg'
export type BoardGameMetadataAvailability = {
  source: BoardGameMetadataSource
  enabled: boolean
  imagesEnabled: boolean
}
export type BoardGameMetadataCandidate = {
  source: BoardGameMetadataSource
  externalId: string
  primaryName: string
  alternateNames: string[]
  yearPublished: number | null
}
export type BoardGameMetadataDetails = BoardGameMetadataCandidate & {
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
export type BoardGameMetadataDetailsRequest = {
  source: BoardGameMetadataSource
  externalId: string
}
export type BoardGameSourceAttribution = {
  label: 'Powered by BGG'
  url: string
}
```

Add `complexityRating`, `metadataSource`, and `metadataImportedAt` to `BoardGameSummary`; remove `difficulty` from `SaveBoardGameFields`; add optional persistence fields to `SaveBoardGameFields`; add `sourceAttribution: BoardGameSourceAttribution | null` to `PublicBoardGameSummary`.

- [ ] **Step 4: Add IPC channels and desktop methods**

```ts
boardGameMetadataStatus: 'board-game-metadata:status',
boardGameMetadataSearch: 'board-game-metadata:search',
boardGameMetadataDetails: 'board-game-metadata:details',
```

```ts
getBoardGameMetadataStatus(): Promise<BoardGameMetadataAvailability>
searchBoardGameMetadata(request: { query: string }): Promise<BoardGameMetadataCandidate[]>
getBoardGameMetadataDetails(request: BoardGameMetadataDetailsRequest): Promise<BoardGameMetadataDetails>
```

- [ ] **Step 5: Run the contract test and workspace typecheck**

Run: `corepack pnpm exec vitest run packages/contracts/src/board-game-metadata.test.ts`

Expected: PASS.

Run: `corepack pnpm --filter @zyapp/contracts typecheck`

Expected: PASS after updating compile errors caused by the intentionally removed save-time `difficulty` field only in the files touched by later tasks; if downstream compile errors remain, record them and continue to Task 2 rather than adding compatibility casts.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/index.ts packages/contracts/src/board-game-metadata.test.ts
git commit -m "feat: define board game metadata contracts"
```

---

### Task 2: Add SQLite Complexity and Provenance Persistence

**Files:**
- Modify: `packages/local-db/src/migrations.ts:1714-end`
- Modify: `packages/local-db/src/local-db.test.ts:1-90,700-765`
- Modify: `packages/local-db/src/board-game.ts`
- Modify: `packages/local-db/src/board-game.test.ts`

**Interfaces:**
- Consumes: Task 1 `SaveBoardGameFields` and `BoardGameSummary`.
- Produces: schema version 30, `deriveLegacyBoardGameDifficulty()`, validated persistence of complexity/provenance, and tenant/BGG uniqueness.

- [ ] **Step 1: Write failing migration and repository assertions**

Add assertions that schema version is `30`, `PRAGMA table_info(board_game)` contains `complexity_tenths`, `metadata_source`, and `metadata_imported_at`, and a created game round-trips:

```ts
expect(created).toMatchObject({
  complexityRating: 2.3,
  difficulty: 'medium',
  bggId: 13,
  metadataSource: 'bgg',
  metadataImportedAt: '2026-08-03T00:00:00.000Z'
})
expect(() => createBoardGame(local.connection, context, {
  ...fields, name: '重复卡坦岛', bggId: 13
})).toThrow(/BGG|UNIQUE/i)
```

Also assert a public/playable/positive-quantity record without complexity is rejected, while `private: true` with no complexity is accepted.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `corepack pnpm exec vitest run packages/local-db/src/local-db.test.ts packages/local-db/src/board-game.test.ts`

Expected: FAIL on schema version, missing columns and missing complexity validation.

- [ ] **Step 3: Add SQLite migration 30**

```ts
{
  version: 30,
  name: 'board-game-metadata-import',
  sql: `
    CREATE TABLE board_game_bgg_migration_guard (
      duplicate_count INTEGER NOT NULL
        CONSTRAINT no_duplicate_board_game_bgg_ids CHECK (duplicate_count = 0)
    ) STRICT;
    INSERT INTO board_game_bgg_migration_guard
    SELECT COUNT(*) FROM (
      SELECT tenant_id, bgg_id FROM board_game
      WHERE bgg_id IS NOT NULL GROUP BY tenant_id, bgg_id HAVING COUNT(*) > 1
    );
    DROP TABLE board_game_bgg_migration_guard;
    ALTER TABLE board_game ADD COLUMN complexity_tenths INTEGER
      CHECK (complexity_tenths BETWEEN 0 AND 50);
    ALTER TABLE board_game ADD COLUMN metadata_source TEXT
      CHECK (metadata_source IN ('bgg'));
    ALTER TABLE board_game ADD COLUMN metadata_imported_at TEXT;
    CREATE UNIQUE INDEX uq_board_game_tenant_bgg_id
      ON board_game(tenant_id, bgg_id) WHERE bgg_id IS NOT NULL;
  `
}
```

- [ ] **Step 4: Implement validation and compatibility conversion**

```ts
export function deriveLegacyBoardGameDifficulty(
  complexityRating: number | undefined
): BoardGameDifficulty {
  if (complexityRating === undefined || complexityRating <= 2) return 'light'
  if (complexityRating <= 3.5) return 'medium'
  return 'heavy'
}

function complexityTenths(value: number | undefined): number | null {
  if (value === undefined) return null
  const tenths = Math.round(value * 10)
  if (!Number.isFinite(value) || tenths < 0 || tenths > 50 ||
      Math.abs(value - tenths / 10) > 1e-9) {
    throw new Error('Board-game complexity must be 0.0-5.0 with one decimal place')
  }
  return tenths
}
```

Require complexity when `!fields.private && fields.available && fields.quantity > 0`. Read `complexity_tenths / 10`, source and timestamp in `findBoardGame`; update create/update SQL and keep all writes inside the existing transaction.

- [ ] **Step 5: Run focused tests**

Run: `corepack pnpm exec vitest run packages/local-db/src/local-db.test.ts packages/local-db/src/board-game.test.ts`

Expected: PASS, including upgrade, restore and duplicate-ID checks.

- [ ] **Step 6: Commit**

```bash
git add packages/local-db/src/migrations.ts packages/local-db/src/local-db.test.ts packages/local-db/src/board-game.ts packages/local-db/src/board-game.test.ts
git commit -m "feat: persist board game complexity metadata"
```

---

### Task 3: Carry Metadata Through Cloud Sync and Mirrors

**Files:**
- Create: `packages/cloud-db/migrations/0020_board_game_metadata_import.sql`
- Modify: `packages/cloud-db/src/migrations.test.ts`
- Modify: `packages/cloud-db/src/schema.ts:495-540`
- Modify: `packages/cloud-db/src/sync-operation-handler.ts:98-125,491-560,1623-1675`
- Modify: `packages/cloud-db/src/sync-operation-handler.test.ts`
- Modify: `packages/local-db/src/cloud-mirror-materialization.ts:309-390`
- Modify: `packages/local-db/src/cloud-baseline.test.ts`
- Modify: `packages/local-db/src/inbound-sync.ts:720-830`
- Modify: `packages/local-db/src/inbound-sync.test.ts`
- Modify: `apps/api/src/desktop-mirror.service.ts:136-180`
- Modify: `apps/api/src/desktop-mirror.service.test.ts`
- Modify: `apps/api/src/employee-content.service.ts`
- Modify: `apps/api/src/employee-content.service.test.ts`

**Interfaces:**
- Consumes: Task 2 SQLite columns and Task 1 summary fields.
- Produces: migration 20, strict `parseBoardGameProjection()` support and lossless desktop/cloud round trips.

- [ ] **Step 1: Add failing projection and round-trip tests**

Use one board-game snapshot containing:

```ts
complexityRating: 2.3,
metadataSource: 'bgg',
metadataImportedAt: '2026-08-03T00:00:00.000Z'
```

Assert `parseBoardGameProjection()` returns those values, rejects `5.01`, and cloud mirror/inbound sync materializes SQLite `complexity_tenths = 23`.

- [ ] **Step 2: Run the focused sync tests to verify failure**

Run: `corepack pnpm exec vitest run packages/cloud-db/src/migrations.test.ts packages/cloud-db/src/sync-operation-handler.test.ts packages/local-db/src/cloud-baseline.test.ts packages/local-db/src/inbound-sync.test.ts apps/api/src/desktop-mirror.service.test.ts apps/api/src/employee-content.service.test.ts`

Expected: FAIL because the new fields are not parsed or materialized.

- [ ] **Step 3: Add cloud migration and Drizzle fields**

```sql
ALTER TABLE cloud_board_game ADD COLUMN metadata_source TEXT;
ALTER TABLE cloud_board_game ADD COLUMN metadata_imported_at TIMESTAMPTZ;
ALTER TABLE cloud_board_game ADD CONSTRAINT ck_cloud_board_game_metadata_source
  CHECK (metadata_source IS NULL OR metadata_source = 'bgg');
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cloud_board_game WHERE bgg_id IS NOT NULL
    GROUP BY tenant_id, bgg_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate tenant BGG ids must be resolved before migration 20';
  END IF;
END $$;
CREATE UNIQUE INDEX uq_cloud_board_game_tenant_bgg_id
  ON cloud_board_game(tenant_id, bgg_id) WHERE bgg_id IS NOT NULL;
```

Add `metadataSource`, `metadataImportedAt` and the unique index to `schema.ts`. Migration 19 already owns `complexity_rating`; do not recreate it.

- [ ] **Step 4: Extend strict projection parsing**

```ts
const complexityRating = nullableDecimal(
  after.complexityRating, 'boardGame.complexityRating', 0, 5, 1
)
const metadataSource = after.metadataSource == null
  ? null
  : enumValue(after.metadataSource, ['bgg'] as const, 'boardGame.metadataSource')
const metadataImportedAt = after.metadataImportedAt == null
  ? null
  : timestamp(after.metadataImportedAt, operation.occurred_at)
```

Add these values to PostgreSQL insert/update parameters, cloud board-game reads, initial baseline payloads, inbound events and mirror materialization. Convert cloud numeric to SQLite tenths with `Math.round(Number(value) * 10)` only after validating one decimal place.

- [ ] **Step 5: Run focused sync tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 6: Run local and cloud typechecks**

Run: `corepack pnpm --filter @zyapp/local-db typecheck`

Run: `corepack pnpm --filter @zyapp/cloud-db typecheck`

Run: `corepack pnpm --filter @zyapp/api typecheck`

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cloud-db/migrations/0020_board_game_metadata_import.sql packages/cloud-db/src packages/local-db/src apps/api/src/desktop-mirror.service.ts apps/api/src/desktop-mirror.service.test.ts apps/api/src/employee-content.service.ts apps/api/src/employee-content.service.test.ts
git commit -m "feat: sync board game metadata provenance"
```

---

### Task 4: Implement the BGG XML Adapter and Configuration Gate

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Create: `apps/api/src/board-game-metadata/bgg-xml.ts`
- Create: `apps/api/src/board-game-metadata/bgg-xml.test.ts`
- Create: `apps/api/src/board-game-metadata/category-map.ts`
- Create: `apps/api/src/board-game-metadata/bgg-adapter.ts`
- Create: `apps/api/src/board-game-metadata/bgg-adapter.test.ts`

**Interfaces:**
- Consumes: Task 1 metadata DTOs.
- Produces: `BoardGameMetadataAdapter`, `BggBoardGameMetadataAdapter`, `parseBggSearchXml()`, `parseBggThingXml()`, and disabled-by-default API configuration.

- [ ] **Step 1: Write synthetic XML parser tests**

Use minimal synthetic XML with BGG's documented shape and no copied description:

```xml
<items total="1"><item type="boardgame" id="13">
  <name type="primary" value="Catan"/><name type="alternate" value="卡坦岛"/>
  <yearpublished value="1995"/>
</item></items>
```

The details fixture includes players, playtime, `averageweight value="2.29"`, category/mechanic links and test image URLs. Assert the normalized complexity is `2.3`, the Chinese mapping is applied, and no `description` field exists in returned JSON.

- [ ] **Step 2: Run parser tests to verify failure**

Run: `corepack pnpm exec vitest run apps/api/src/board-game-metadata/bgg-xml.test.ts apps/api/src/board-game-metadata/bgg-adapter.test.ts`

Expected: FAIL because parser, adapter and XML dependency do not exist.

- [ ] **Step 3: Add the XML dependency**

Run: `corepack pnpm --filter @zyapp/api add fast-xml-parser`

Expected: `apps/api/package.json` and `pnpm-lock.yaml` change; no other package is added.

- [ ] **Step 4: Implement fixed mappings and pure parsers**

```ts
export const BGG_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  'Abstract Strategy': '抽象策略', 'Card Game': '卡牌',
  Deduction: '推理', Economic: '经营', Fantasy: '奇幻',
  'Party Game': '聚会', Puzzle: '解谜', 'Science Fiction': '科幻',
  Wargame: '战争', 'Word Game': '文字',
  'Cooperative Game': '合作',
  'Deck, Bag, and Pool Building': '牌库构筑',
  'Worker Placement': '工人放置', 'Tile Placement': '板块放置',
  'Set Collection': '套装收集'
}
```

Configure `XMLParser` with `ignoreAttributes: false` and `attributeNamePrefix: '@_'`. Normalize single-or-array nodes, cap names/tags at contract limits, round `averageweight` to one decimal, and reject non-boardgame items or invalid IDs.

- [ ] **Step 5: Implement the authenticated fixed-host adapter**

```ts
export interface BoardGameMetadataAdapter {
  readonly source: 'bgg'
  readonly enabled: boolean
  readonly imagesEnabled: boolean
  search(query: string): Promise<BoardGameMetadataCandidate[]>
  details(externalId: string): Promise<BoardGameMetadataDetails>
}
```

Use `Authorization: Bearer <token>`, `Accept: application/xml`, `AbortSignal.timeout(10_000)`, a 1 MiB response cap, and only the two fixed HTTPS endpoints. Return stable adapter errors for disabled, unauthorized, throttled, unavailable, timeout and malformed XML states.

- [ ] **Step 6: Add disabled-by-default configuration**

Add:

```ts
bggMetadataMode: 'disabled' | 'xmlapi'
bggXmlApiTokenFile: string | null
bggPublicImagesEnabled: boolean
```

Rules: default mode is `disabled`; `xmlapi` requires `BGG_XML_API_TOKEN_FILE`; images may be true only in `xmlapi` mode. Read the token with the existing `readSingleLineSecret()` in the provider factory, never in `readApiConfig()` test snapshots or logs.

- [ ] **Step 7: Run adapter and config tests**

Run: `corepack pnpm exec vitest run apps/api/src/config.test.ts apps/api/src/board-game-metadata/bgg-xml.test.ts apps/api/src/board-game-metadata/bgg-adapter.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/config.ts apps/api/src/config.test.ts apps/api/src/board-game-metadata
git commit -m "feat: add gated BGG metadata adapter"
```

---

### Task 5: Add Manager-Authorized API, Redis Cache and Shared Rate Gate

**Files:**
- Create: `apps/api/src/board-game-metadata/request-gate.ts`
- Create: `apps/api/src/board-game-metadata/request-gate.test.ts`
- Create: `apps/api/src/board-game-metadata/board-game-metadata.service.ts`
- Create: `apps/api/src/board-game-metadata/board-game-metadata.service.test.ts`
- Create: `apps/api/src/board-game-metadata/board-game-metadata.controller.ts`
- Create: `apps/api/src/board-game-metadata/board-game-metadata.controller.test.ts`
- Modify: `apps/api/src/infrastructure.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: Task 4 adapter, global `REDIS_CLIENT`, `POSTGRES_POOL`, `API_CONFIG`, and `DeviceAuthGuard`.
- Produces: `GET /v1/board-game-metadata/status`, `/search`, and `/bgg/:externalId`.

- [ ] **Step 1: Write failing service tests**

Cover manager authorization, employee/store mismatch, disabled status, 120-character query cap, 20-result cap, positive integer external IDs, Redis hit, Redis failure and adapter error mapping. The manager query must require active employee identity and active manager access for `principal.tenantId` and `principal.storeId`.

- [ ] **Step 2: Write failing request-gate tests with fake timers**

Assert:

```ts
expect(await gate.cached('search:key', 86_400, load)).toEqual(first)
expect(await gate.cached('search:key', 86_400, load)).toEqual(first)
expect(load).toHaveBeenCalledTimes(1)
expect(redis.set).toHaveBeenCalledWith(
  'zyapp:bgg:request-start', expect.any(String), 'PX', 5_000, 'NX'
)
```

Also assert a Redis `get` error rejects without calling `load`.

- [ ] **Step 3: Run focused tests to verify failure**

Run: `corepack pnpm exec vitest run apps/api/src/board-game-metadata/request-gate.test.ts apps/api/src/board-game-metadata/board-game-metadata.service.test.ts apps/api/src/board-game-metadata/board-game-metadata.controller.test.ts`

Expected: FAIL because the API feature does not exist.

- [ ] **Step 4: Implement cache and five-second gate**

Hash normalized query cache keys with SHA-256; cache candidate JSON for `86_400` seconds and details for `604_800` seconds. Acquire the Redis `NX PX 5000` start key before an uncached adapter call; poll at 100 ms with a 10-second ceiling. Do not delete the key early because its TTL defines the minimum start interval.

- [ ] **Step 5: Implement authorization and stable endpoints**

```ts
@UseGuards(DeviceAuthGuard)
@Controller('board-game-metadata')
export class BoardGameMetadataController {
  @Get('status') status(@Req() req: DeviceRequest, @Query('actorId') actorId: string) {}
  @Get('search') search(@Req() req: DeviceRequest,
    @Query('actorId') actorId: string, @Query('query') query: string) {}
  @Get('bgg/:externalId') details(@Req() req: DeviceRequest,
    @Query('actorId') actorId: string, @Param('externalId') externalId: string) {}
}
```

Map disabled to `503`, invalid input to `400`, unauthorized actor to `403`, missing item to `404`, BGG throttle/unavailable to `503`, and timeout to `504`. Never forward BGG response bodies.

- [ ] **Step 6: Register provider, service and controller**

The adapter provider factory returns a disabled adapter in default mode or reads the Token file and constructs `BggBoardGameMetadataAdapter` in `xmlapi` mode. Export no Token-bearing provider outside the API process.

- [ ] **Step 7: Run focused API tests and typecheck**

Run the Step 3 command.

Run: `corepack pnpm --filter @zyapp/api typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/board-game-metadata apps/api/src/infrastructure.module.ts apps/api/src/app.module.ts
git commit -m "feat: expose cached board game metadata API"
```

---

### Task 6: Bridge Metadata Through the Desktop Main Process

**Files:**
- Modify: `apps/merchant-desktop/src/main/cloud-sync-client.ts`
- Modify: `apps/merchant-desktop/src/main/cloud-sync-client.test.ts`
- Modify: `apps/merchant-desktop/src/main/index.ts:1959-2030,4338-4435`
- Modify: `apps/merchant-desktop/src/preload/index.ts:130-155`
- Modify: `apps/merchant-desktop/src/renderer/src/api.ts:1490-1570`

**Interfaces:**
- Consumes: Task 1 Desktop API/IPC types and Task 5 endpoints.
- Produces: `getCloudBoardGameMetadataStatus()`, `searchCloudBoardGameMetadata()`, `getCloudBoardGameMetadataDetails()` and permission-checked IPC handlers.

- [ ] **Step 1: Add failing cloud-client request tests**

Assert exact device-authenticated URLs and no Token header other than the existing ZyApp device token:

```ts
await searchCloudBoardGameMetadata(connection, actorId, { query: '卡坦岛' }, fetchMock)
expect(fetchMock.mock.calls[0]?.[0]).toContain(
  '/v1/board-game-metadata/search?actorId=' + encodeURIComponent(actorId) + '&query='
)
expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body')
```

Cover status, search, details, encoded Chinese queries and `CloudRequestError` propagation.

- [ ] **Step 2: Run the client test to verify failure**

Run: `corepack pnpm exec vitest run apps/merchant-desktop/src/main/cloud-sync-client.test.ts`

Expected: FAIL because the functions do not exist.

- [ ] **Step 3: Implement cloud-client methods**

Use existing `normalizeCloudBaseUrl()`, `headers(connection)`, `responseJson()` and 10-second timeouts. Details only accept `source === 'bgg'` and positive decimal `externalId`.

- [ ] **Step 4: Add main/preload IPC handlers**

Each handler must:

```ts
const session = requireSession(event, PERMISSIONS.contentManage)
if (!cloudConnection) throw new Error('BGG 搜索需要连接 ZyApp 云端')
return searchCloudBoardGameMetadata(cloudConnection, session.id, {
  query: requireText(request?.query, '桌游搜索词', { min: 1, max: 120 })
})
```

Validate details source/ID in main before making the cloud call. Add preload methods that only invoke the named channels.

- [ ] **Step 5: Update renderer mock API**

Return `{ source: 'bgg', enabled: false, imagesEnabled: false }` for preview status and an explanatory error for preview search/details; do not silently return fake BGG results outside explicit unit fixtures.

- [ ] **Step 6: Run tests and desktop typecheck**

Run: `corepack pnpm exec vitest run apps/merchant-desktop/src/main/cloud-sync-client.test.ts`

Run: `corepack pnpm --filter @zyapp/merchant-desktop typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/merchant-desktop/src/main/cloud-sync-client.ts apps/merchant-desktop/src/main/cloud-sync-client.test.ts apps/merchant-desktop/src/main/index.ts apps/merchant-desktop/src/preload/index.ts apps/merchant-desktop/src/renderer/src/api.ts
git commit -m "feat: bridge BGG metadata to desktop"
```

---

### Task 7: Build the Fast PC Entry Editor

**Files:**
- Create: `apps/merchant-desktop/src/renderer/src/board-game-editor.ts`
- Create: `apps/merchant-desktop/src/renderer/src/board-game-editor.test.ts`
- Create: `apps/merchant-desktop/src/renderer/src/BoardGameEditorModal.tsx`
- Modify: `apps/merchant-desktop/src/renderer/src/ContentPage.tsx`
- Modify: `apps/merchant-desktop/src/renderer/src/styles.css:3433-end`

**Interfaces:**
- Consumes: Task 6 desktop methods and Task 1 DTOs.
- Produces: `parseBggLookupInput()`, `applyMetadataDetails()`, `boardGameRequest()`, and a focused modal component.

- [ ] **Step 1: Write failing pure editor tests**

Cover numeric IDs, canonical BGG links, invalid arbitrary URLs, Chinese alternate-name preference, preservation of a non-empty Chinese introduction, mapped categories, nullable complexity, image permission and provenance:

```ts
expect(parseBggLookupInput('https://boardgamegeek.com/boardgame/13/catan'))
  .toEqual({ kind: 'id', externalId: '13' })
expect(applyMetadataDetails(emptyEditor, details, true)).toMatchObject({
  name: '卡坦岛', minPlayers: '3', maxPlayers: '4',
  complexityRating: '2.3', bggId: '13', metadataSource: 'bgg',
  metadataImportedAt: details.fetchedAt
})
expect(applyMetadataDetails(
  { ...emptyEditor, introduction: '店方中文简介' }, details, false
).introduction).toBe('店方中文简介')
```

- [ ] **Step 2: Run the editor test to verify failure**

Run: `corepack pnpm exec vitest run apps/merchant-desktop/src/renderer/src/board-game-editor.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement pure editor conversion**

`parseBggLookupInput()` returns `{ kind: 'id'; externalId }` for a positive integer or canonical `boardgamegeek.com/boardgame/<id>` URL; otherwise returns `{ kind: 'query'; query }`. `applyMetadataDetails()` chooses the first CJK alternate name, otherwise preserves a CJK query/name, otherwise leaves the Chinese name field for manager confirmation. It never modifies `introduction` from BGG data.

`boardGameRequest()` parses `complexityRating`, rejects more than one decimal, omits it when empty, and includes source/import timestamp only after details were successfully applied.

- [ ] **Step 4: Run helper tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Extract and build `BoardGameEditorModal`**

The modal renders, in order:

```text
快速查找：输入框 + 搜索按钮 + 禁用/错误说明
候选列表：原名 / 中文别名 / 年份 / BGG ID
公开资料：中文名称 / 中文简介 / 中文分类 / 人数 / 时长 / 复杂度 / 图片
本店配置：数量 / 可用 / 不公开 / 推荐 / 寄存 / 缺件 / 备注
操作：取消 / 保存
```

Search only on Enter or button click. Direct IDs/links skip the list and load details. Selecting details fills the editor but never calls `createBoardGame`. Show “来自 BGG，保存前请核对” next to imported structured fields. Keep local image upload unchanged.

- [ ] **Step 6: Reduce `ContentPage` to orchestration**

Move editor types and conversion helpers out of `ContentPage.tsx`; keep list loading, permission checks, modal open/close and post-save refresh. Remove the light/medium/heavy selector and replace it with a decimal input `min="0" max="5" step="0.1"`.

- [ ] **Step 7: Add focused styling**

Add `.metadata-search`, `.metadata-results`, `.metadata-result`, `.metadata-source-note`, `.game-editor-sections` and narrow-screen rules. Keep the existing modal scroll container and ensure primary actions remain visible at 1024×768.

- [ ] **Step 8: Run desktop tests, typecheck and build**

Run: `corepack pnpm exec vitest run apps/merchant-desktop/src/renderer/src/board-game-editor.test.ts apps/merchant-desktop/src/main/cloud-sync-client.test.ts`

Run: `corepack pnpm --filter @zyapp/merchant-desktop typecheck`

Run: `corepack pnpm --filter @zyapp/merchant-desktop build`

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/merchant-desktop/src/renderer/src/board-game-editor.ts apps/merchant-desktop/src/renderer/src/board-game-editor.test.ts apps/merchant-desktop/src/renderer/src/BoardGameEditorModal.tsx apps/merchant-desktop/src/renderer/src/ContentPage.tsx apps/merchant-desktop/src/renderer/src/styles.css
git commit -m "feat: build fast board game entry editor"
```

---

### Task 8: Keep the Public API and Mini-Program Attribution Consistent

**Files:**
- Modify: `apps/api/src/public-content.service.ts:223-365`
- Modify: `apps/api/src/public-content.service.test.ts`
- Modify: `apps/miniapp/src/services/mock-client.ts`
- Modify: `apps/miniapp/src/services/board-game-library.test.ts`
- Modify: `apps/miniapp/src/pages/games/index.ts`
- Modify carefully: `apps/miniapp/src/pages/games/index.wxml`
- Modify carefully: `apps/miniapp/src/pages/games/index.wxss`
- Modify carefully: `apps/miniapp/scripts/board-game-library-layout.test.mjs`

**Interfaces:**
- Consumes: Task 3 cloud provenance and Task 1 `sourceAttribution`.
- Produces: safe API attribution and one mini-program result-footer attribution action.

- [ ] **Step 1: Inspect and preserve the user's current mini-program diff**

Run: `git diff -- apps/miniapp/src/pages/games/index.wxml apps/miniapp/src/pages/games/index.wxss apps/miniapp/scripts/board-game-library-layout.test.mjs`

Expected: existing user changes remain visible. Save the diff output for comparison after patching; do not reset or replace these files wholesale.

- [ ] **Step 2: Add failing API attribution tests**

Extend test rows with `metadata_source` and `bgg_id`. Assert:

```ts
expect(result[0]?.sourceAttribution).toEqual({
  label: 'Powered by BGG',
  url: 'https://boardgamegeek.com/boardgame/13'
})
expect(result[1]?.sourceAttribution).toBeNull()
```

Also assert the public DTO contains neither `metadataSource` nor `bggId`.

- [ ] **Step 3: Add failing mini-program tests**

Add `sourceAttribution: null` to all existing mock fixtures and one sourced fixture. Require the games page to render `Powered by BGG` once when any result is attributed and to bind a `copyBggSource` action.

- [ ] **Step 4: Run focused tests to verify failure**

Run: `corepack pnpm exec vitest run apps/api/src/public-content.service.test.ts apps/miniapp/src/services/board-game-library.test.ts`

Run: `node --test apps/miniapp/scripts/board-game-library-layout.test.mjs`

Expected: FAIL because attribution is not selected, mapped or rendered.

- [ ] **Step 5: Generate safe attribution in the API**

Select internal `metadata_source` and `bgg_id`, then map only:

```ts
sourceAttribution:
  row.metadata_source === 'bgg' && row.bgg_id !== null
    ? { label: 'Powered by BGG',
        url: `https://boardgamegeek.com/boardgame/${Number(row.bgg_id)}` }
    : null
```

Never return raw provenance fields.

- [ ] **Step 6: Render one result-footer attribution**

Derive the first non-null attribution from loaded games. Render one footer below results. Because arbitrary external links cannot be assumed to open inside WeChat, bind the action to `wx.setClipboardData({ data: attribution.url })` and show `BGG 来源链接已复制`; production enablement still waits for BGG to accept the final WeChat attribution behavior in writing.

- [ ] **Step 7: Run mini-program and API tests**

Run the Step 4 commands.

Run: `corepack pnpm --filter @zyapp/miniapp typecheck`

Expected: all PASS.

- [ ] **Step 8: Recheck the pre-existing mini-program diff**

Run the Step 1 command again.

Expected: the user's prior layout changes are still present, with only the attribution additions layered on top.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/public-content.service.ts apps/api/src/public-content.service.test.ts apps/miniapp/src/services/mock-client.ts apps/miniapp/src/services/board-game-library.test.ts apps/miniapp/src/pages/games/index.ts apps/miniapp/src/pages/games/index.wxml apps/miniapp/src/pages/games/index.wxss apps/miniapp/scripts/board-game-library-layout.test.mjs
git commit -m "feat: expose board game source attribution"
```

---

### Task 9: Add Deployment-Safe Configuration and Complete Verification

**Files:**
- Modify: `infra/docker/cloud.env.example`
- Modify: `infra/docker/compose.yml`
- Modify: `infra/deploy/production.env.example`
- Modify: `infra/deploy/compose.production.yml`
- Modify: `infra/deploy/README.md`
- Modify: `docs/开发任务路线图-v1.md`
- Modify: `docs/正式需求基线-v2-PC优先.md`
- Verify: `docs/superpowers/specs/2026-08-03-pc-board-game-entry-bgg-import-design.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: disabled-by-default deployment configuration, full regression evidence and updated delivery status without enabling real BGG access.

- [ ] **Step 1: Add configuration contract tests before deployment edits**

Extend `apps/api/src/config.test.ts` to assert default disabled mode, rejection of `xmlapi` without a Token file, and rejection of images in disabled mode. Run:

`corepack pnpm exec vitest run apps/api/src/config.test.ts`

Expected: PASS from Task 4; this is the release guard before editing Compose.

- [ ] **Step 2: Add safe example and Compose variables**

Add only non-secret examples:

```dotenv
BGG_METADATA_MODE=disabled
BGG_XML_API_TOKEN_FILE=/run/secrets/bgg/xml-api-token
BGG_PUBLIC_IMAGES_ENABLED=false
BGG_SECRETS_DIRECTORY=/opt/zyapp/secrets/bgg
```

Production and test API services receive mode/images variables and mount `${BGG_SECRETS_DIRECTORY:-/opt/zyapp/secrets/bgg}:/run/secrets/bgg:ro`. Keep both modes `disabled` in examples. Do not edit or stage `infra/deploy/production.env`, any pre-domain backup, or any real secret file.

- [ ] **Step 3: Run the complete targeted suite**

Run:

```text
corepack pnpm exec vitest run packages/contracts/src/board-game-metadata.test.ts packages/local-db/src/local-db.test.ts packages/local-db/src/board-game.test.ts packages/cloud-db/src/migrations.test.ts packages/cloud-db/src/sync-operation-handler.test.ts packages/local-db/src/cloud-baseline.test.ts packages/local-db/src/inbound-sync.test.ts apps/api/src/config.test.ts apps/api/src/board-game-metadata apps/api/src/public-content.service.test.ts apps/merchant-desktop/src/main/cloud-sync-client.test.ts apps/merchant-desktop/src/renderer/src/board-game-editor.test.ts apps/miniapp/src/services/board-game-library.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run all workspace gates**

Run: `corepack pnpm test`

Run: `corepack pnpm typecheck`

Run: `corepack pnpm build`

Run: `corepack pnpm --filter @zyapp/miniapp test`

Expected: all PASS. If an unrelated dirty mini-program test fails, report the exact pre-existing diff and failure without overwriting it.

- [ ] **Step 5: Run desktop package smoke verification**

Run: `corepack pnpm --filter @zyapp/merchant-desktop build`

Then use the existing Windows packaging command and isolated data-root smoke procedure documented in the repository. Verify renderer load, schema version 30, no renderer crash and no BGG Token string in `apps/merchant-desktop/out` or `dist-installer`.

- [ ] **Step 6: Update authoritative status without claiming production enablement**

Record automated implementation as complete only if Steps 3–5 pass. Keep these gates explicitly pending: BGG Commercial Application approval, real Token test-environment configuration, image/public-attribution written scope, real search validation, production data backfill, WeChat experience build and owner production approval.

- [ ] **Step 7: Inspect final scope and secrets**

Run:

```text
git status --short
git diff --check
git diff --name-only
rg -n "BGG_XML_API_TOKEN|Authorization: Bearer" apps packages infra --glob '!**/dist/**' --glob '!**/out/**'
```

Expected: no Token value; only configuration names, adapter header construction and documentation appear. Unrelated user files remain unstaged.

- [ ] **Step 8: Commit**

```bash
git add infra/docker/cloud.env.example infra/docker/compose.yml infra/deploy/production.env.example infra/deploy/compose.production.yml infra/deploy/README.md docs/开发任务路线图-v1.md docs/正式需求基线-v2-PC优先.md
git commit -m "docs: record board game entry verification"
```

---

## Production Activation Runbook After BGG Approval

This runbook is intentionally not part of the implementation commits above and must be executed only after the user provides the approved license and Token.

1. Read the approval and record whether public structured data, thumbnails, full images and WeChat attribution behavior are allowed.
2. Create `/opt/zyapp/secrets/bgg/xml-api-token` with owner-only permissions on the server; never paste the Token into Git, chat logs, `.env`, shell history or diagnostics.
3. Enable `BGG_METADATA_MODE=xmlapi` in the test deployment only; leave production disabled.
4. Keep `BGG_PUBLIC_IMAGES_ENABLED=false` unless images are explicitly covered.
5. Deploy test API, perform one English-name, one Chinese-alias, one BGG-ID and one BGG-link search, and inspect Redis request spacing.
6. Save one test board game, sync it, and verify the mini-program fields and approved attribution behavior.
7. Obtain the user's explicit production approval before enabling the production API.
