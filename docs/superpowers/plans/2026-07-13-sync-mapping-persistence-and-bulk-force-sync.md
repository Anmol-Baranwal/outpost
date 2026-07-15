# Sync Mapping Persistence + Bulk Force-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish two 501-stub endpoints behind the `/sync` dashboard (mapping config persistence, bulk force-sync), and make the mapping config actually change the running sync worker's behavior — not just round-trip through the dashboard.

**Architecture:** Reuse the existing `SystemConfig` key-value table for mapping persistence (no schema change). Reuse the existing `TRACKER_SYNC` job/handler for bulk sync (no new job type). Fix a latent bug found while tracing this: `apps/worker/src/index.ts` builds a bare `SyncEngine` with zero registered plugins — `initializeSyncEngine()` (which registers the Linear adapter) is never called anywhere in `apps/`. Wire that in for Linear only; GitHub adapter registration needs new Octokit-in-worker plumbing and is explicitly out of scope for this plan.

**Tech Stack:** Next.js API routes, Prisma, Vitest (mocked Prisma per repo convention), the existing `@copilotkit/outpost/shared` sync package.

## Global Constraints

- No new Prisma models or migrations — `SystemConfig` (key/value) already exists.
- No new `JobType` — bulk sync reuses `TRACKER_SYNC` per linked ticket.
- `Ticket` has no tags/labels field in the current schema — bulk resync only pushes `status_change` and `priority_change`, never `label_change`.
- GitHub adapter registration in the worker is out of scope — only the Linear adapter gets wired up. Bulk force-sync for `plugin: 'github'` will still fail with "Plugin not registered", same as before this plan (not a regression).
- Every task ends with passing tests using this repo's existing mocked-Prisma Vitest convention (see `apps/web/src/__tests__/sync-api.test.ts` and `packages/outpost/shared/src/dispatch/__tests__/dispatch.test.ts` for the pattern). No task is done without a red-then-green test cycle.

---

## Task 1: Persist mapping config via SystemConfig

**Files:**

- Modify: `apps/web/src/app/api/sync/mappings/route.ts`
- Modify: `apps/web/src/__tests__/sync-api.test.ts:229-272` (the two `describe` blocks for `GET`/`PUT /api/sync/mappings`)

**Interfaces:**

- Consumes: `prisma.systemConfig.findUnique({ where: { key } })` / `.upsert({ where, update, create })` — same shape already used in `packages/outpost/shared/src/dispatch/on-call.ts:45-60`.
- Produces: `MAPPING_CONFIG_KEY = 'sync.mappingConfig'` constant (exported from this route file) — Task 2 imports the same string literal into `status-map.ts` (kept as a plain string constant, not cross-imported, to avoid a web→shared reverse dependency; both sides must use the exact string `'sync.mappingConfig'`).

- [ ] **Step 1: Write the failing tests**

Replace the two existing `describe` blocks at the bottom of `apps/web/src/__tests__/sync-api.test.ts` (lines 229-272) with:

```typescript
describe('GET /api/sync/mappings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('falls back to defaults when no SystemConfig row exists', async () => {
        mockExternalIdentityFindMany.mockResolvedValue([]);
        mockSystemConfigFindUnique.mockResolvedValue(null);

        const res = await getMappings();
        const body = await res.json();

        expect(body.statusMappings.linear).toContainEqual({
            externalStatus: 'Triage',
            outpostStatus: 'OPEN',
        });
        expect(body.priorityMappings).toBeDefined();
        expect(body.identityMappings).toBeDefined();
        expect(body.labelRules).toBeDefined();
    });

    it('returns the persisted config when a SystemConfig row exists', async () => {
        mockExternalIdentityFindMany.mockResolvedValue([]);
        const saved = {
            statusMappings: { linear: [{ externalStatus: 'Custom', outpostStatus: 'OPEN' }] },
            priorityMappings: { linear: [] },
            labelRules: { linear: [] },
        };
        mockSystemConfigFindUnique.mockResolvedValue({
            key: 'sync.mappingConfig',
            value: JSON.stringify(saved),
        });

        const res = await getMappings();
        const body = await res.json();

        expect(body.statusMappings).toEqual(saved.statusMappings);
    });
});

describe('PUT /api/sync/mappings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1', 'ADMIN'));
    });

    it('persists a valid mapping update', async () => {
        const config = {
            statusMappings: { linear: [{ externalStatus: 'Done', outpostStatus: 'RESOLVED' }] },
            priorityMappings: { linear: [] },
        };
        mockSystemConfigUpsert.mockResolvedValue({
            key: 'sync.mappingConfig',
            value: JSON.stringify(config),
        });

        const req = makeJsonRequest('http://localhost:3000/api/sync/mappings', config, 'PUT');
        const res = await putMappings(req as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(mockSystemConfigUpsert).toHaveBeenCalledWith({
            where: { key: 'sync.mappingConfig' },
            update: { value: JSON.stringify(config) },
            create: { key: 'sync.mappingConfig', value: JSON.stringify(config) },
        });
        expect(body.statusMappings).toEqual(config.statusMappings);
    });

    it('rejects when required fields missing', async () => {
        const req = makeJsonRequest('http://localhost:3000/api/sync/mappings', {}, 'PUT');
        const res = await putMappings(req as never);

        expect(res.status).toBe(400);
        expect(mockSystemConfigUpsert).not.toHaveBeenCalled();
    });

    it('requires admin role', async () => {
        mockGetServerSession.mockResolvedValue(userSession('tm-1', 'MEMBER'));

        const req = makeJsonRequest(
            'http://localhost:3000/api/sync/mappings',
            {
                statusMappings: { linear: [] },
                priorityMappings: { linear: [] },
            },
            'PUT',
        );
        const res = await putMappings(req as never);

        expect(res.status).toBe(403);
        expect(mockSystemConfigUpsert).not.toHaveBeenCalled();
    });
});
```

Also add the two new mock functions near the top of the file, next to the existing `mockExternalIdentityFindMany` declaration (around line 10) and inside the `vi.mock('@copilotkit/outpost/db', ...)` block (around line 12-25):

```typescript
const mockSystemConfigFindUnique = vi.fn();
const mockSystemConfigUpsert = vi.fn();
```

Add `systemConfig` alongside the existing `syncEvent`/`externalIdentity` keys inside the `prisma` mock object:

```typescript
        systemConfig: {
            findUnique: (...args: unknown[]) => mockSystemConfigFindUnique(...args),
            upsert: (...args: unknown[]) => mockSystemConfigUpsert(...args),
        },
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm test -- sync-api.test.ts`
Expected: FAIL — `GET /api/sync/mappings` tests fail because the route ignores `mockSystemConfigFindUnique` and still returns hardcoded defaults only; `PUT` tests fail with 501 (route still returns "not yet implemented").

- [ ] **Step 3: Implement mapping persistence**

Replace the `GET` and `PUT` handlers in `apps/web/src/app/api/sync/mappings/route.ts` (keep the `DEFAULT_STATUS_MAPPINGS` / `DEFAULT_PRIORITY_MAPPINGS` / `DEFAULT_LABEL_RULES` constants as-is):

```typescript
export const MAPPING_CONFIG_KEY = 'sync.mappingConfig';

interface PersistedMappingConfig {
    statusMappings: typeof DEFAULT_STATUS_MAPPINGS;
    priorityMappings: typeof DEFAULT_PRIORITY_MAPPINGS;
    labelRules?: typeof DEFAULT_LABEL_RULES;
}

async function readPersistedConfig(): Promise<PersistedMappingConfig | null> {
    const row = await prisma.systemConfig.findUnique({ where: { key: MAPPING_CONFIG_KEY } });
    if (!row) return null;
    try {
        return JSON.parse(row.value) as PersistedMappingConfig;
    } catch {
        return null;
    }
}

/**
 * GET /api/sync/mappings
 *
 * Returns the current mapping configuration. Identity mappings are always
 * fetched live from the ExternalIdentity table. Status/priority/label
 * mappings come from the persisted SystemConfig row if one exists, else
 * the code defaults.
 */
export async function GET() {
    const { error } = await requireSession();
    if (error) return error;

    const identities = await prisma.externalIdentity.findMany({
        include: { member: { select: { id: true, name: true } } },
    });

    const identityMappings = identities.map((ei: (typeof identities)[number]) => ({
        id: ei.id,
        externalPlugin: ei.plugin,
        externalUserId: ei.externalId,
        externalDisplayName: ei.externalId,
        memberId: ei.member?.id ?? null,
        memberName: ei.member?.name ?? null,
    }));

    const persisted = await readPersistedConfig();

    return NextResponse.json({
        statusMappings: persisted?.statusMappings ?? DEFAULT_STATUS_MAPPINGS,
        priorityMappings: persisted?.priorityMappings ?? DEFAULT_PRIORITY_MAPPINGS,
        identityMappings,
        labelRules: persisted?.labelRules ?? DEFAULT_LABEL_RULES,
    });
}

/**
 * PUT /api/sync/mappings
 *
 * Persists the mapping configuration as a single JSON row in SystemConfig.
 * Body: MappingConfig (statusMappings, priorityMappings required; labelRules optional)
 */
export async function PUT(request: NextRequest) {
    const { error } = await requireAdmin();
    if (error) return error;

    try {
        const body = await request.json();

        if (!body.statusMappings || !body.priorityMappings) {
            return NextResponse.json(
                { error: 'statusMappings and priorityMappings are required' },
                { status: 400 },
            );
        }

        const config: PersistedMappingConfig = {
            statusMappings: body.statusMappings,
            priorityMappings: body.priorityMappings,
            labelRules: body.labelRules ?? DEFAULT_LABEL_RULES,
        };
        const value = JSON.stringify(config);

        await prisma.systemConfig.upsert({
            where: { key: MAPPING_CONFIG_KEY },
            update: { value },
            create: { key: MAPPING_CONFIG_KEY, value },
        });

        return NextResponse.json(config);
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
}
```

Note the `requireAdmin` 403 case (test "requires admin role") already works via the existing `requireAdmin()` call — no extra code needed there, it's covered by the auth helper.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm test -- sync-api.test.ts`
Expected: PASS — all `GET`/`PUT /api/sync/mappings` tests green, plus all pre-existing tests in the file still green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/sync/mappings/route.ts apps/web/src/__tests__/sync-api.test.ts
git commit -m "feat(sync): persist mapping config to SystemConfig"
```

---

## Task 2: Load status map from persisted config

**Files:**

- Modify: `packages/outpost/shared/src/sync/status-map.ts`
- Modify: `packages/outpost/shared/src/sync/index.ts:4` (export the new function)
- Create: `packages/outpost/shared/src/sync/__tests__/status-map.test.ts`

**Interfaces:**

- Consumes: nothing new from earlier tasks (the `'sync.mappingConfig'` key string must match Task 1's `MAPPING_CONFIG_KEY` value exactly).
- Produces: `loadStatusMap(plugin: 'linear' | 'github', db: StatusMapDb): Promise<StatusMap>` and `export interface StatusMapDb`. Task 3 imports both.

- [ ] **Step 1: Write the failing test**

Create `packages/outpost/shared/src/sync/__tests__/status-map.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { loadStatusMap } from '../status-map.js';
import { TicketStatus } from '../../types.js';

function makeDb(row: { key: string; value: string } | null) {
    return { systemConfig: { findUnique: vi.fn().mockResolvedValue(row) } };
}

describe('loadStatusMap', () => {
    it('falls back to the hardcoded Linear map when no config row exists', async () => {
        const db = makeDb(null);
        const map = await loadStatusMap('linear', db);

        expect(map.toOutpost('Done')).toBe(TicketStatus.RESOLVED);
    });

    it('falls back to the hardcoded GitHub map when no config row exists', async () => {
        const db = makeDb(null);
        const map = await loadStatusMap('github', db);

        expect(map.toOutpost('closed')).toBe(TicketStatus.CLOSED);
    });

    it('builds from persisted config when present for the requested plugin', async () => {
        const config = {
            statusMappings: {
                linear: [{ externalStatus: 'Shipped', outpostStatus: 'RESOLVED' }],
            },
        };
        const db = makeDb({ key: 'sync.mappingConfig', value: JSON.stringify(config) });

        const map = await loadStatusMap('linear', db);

        expect(map.toOutpost('Shipped')).toBe(TicketStatus.RESOLVED);
        // 'Done' is no longer in the map since the persisted config replaced it entirely
        expect(map.toOutpost('Done')).toBe(TicketStatus.OPEN); // StatusMap.toOutpost default fallback
    });

    it('falls back to defaults when persisted config has no entry for this plugin', async () => {
        const config = {
            statusMappings: { linear: [{ externalStatus: 'X', outpostStatus: 'OPEN' }] },
        };
        const db = makeDb({ key: 'sync.mappingConfig', value: JSON.stringify(config) });

        const map = await loadStatusMap('github', db);

        expect(map.toOutpost('closed')).toBe(TicketStatus.CLOSED);
    });

    it('falls back to defaults when the persisted value is malformed JSON', async () => {
        const db = makeDb({ key: 'sync.mappingConfig', value: 'not json' });

        const map = await loadStatusMap('linear', db);

        expect(map.toOutpost('Done')).toBe(TicketStatus.RESOLVED);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/outpost/shared && pnpm test -- status-map.test.ts`
Expected: FAIL with `loadStatusMap is not a function` / import error (not yet exported).

- [ ] **Step 3: Implement `loadStatusMap`**

Append to `packages/outpost/shared/src/sync/status-map.ts` (keep everything already in the file, add below `createLinearStatusMap`):

```typescript
// ─── Persisted Config Loading ─────────────────────────────────────────────

/** Must match the key used by apps/web/src/app/api/sync/mappings/route.ts. */
const MAPPING_CONFIG_KEY = 'sync.mappingConfig';

/** Minimal Prisma subset needed to load a persisted mapping config. */
export interface StatusMapDb {
    systemConfig: {
        findUnique(args: {
            where: { key: string };
        }): Promise<{ key: string; value: string } | null>;
    };
}

interface PersistedStatusMappingEntry {
    externalStatus: string;
    outpostStatus: TicketStatus;
}

/**
 * Build a StatusMap for `plugin`, preferring the persisted SystemConfig
 * row (written by the /api/sync/mappings dashboard) over the hardcoded
 * factory defaults. Falls back to the hardcoded default whenever the
 * config row is missing, malformed, or has no entry for this plugin.
 */
export async function loadStatusMap(
    plugin: 'linear' | 'github',
    db: StatusMapDb,
): Promise<StatusMap> {
    const fallback = plugin === 'linear' ? createLinearStatusMap() : createGitHubStatusMap();

    const row = await db.systemConfig.findUnique({ where: { key: MAPPING_CONFIG_KEY } });
    if (!row) return fallback;

    let parsed: unknown;
    try {
        parsed = JSON.parse(row.value);
    } catch {
        return fallback;
    }

    const entries = (parsed as { statusMappings?: Record<string, PersistedStatusMappingEntry[]> })
        ?.statusMappings?.[plugin];
    if (!Array.isArray(entries) || entries.length === 0) return fallback;

    const config: StatusMappingConfig = {};
    for (const entry of entries) {
        if (entry?.externalStatus && entry?.outpostStatus) {
            config[entry.externalStatus] = entry.outpostStatus;
        }
    }
    return Object.keys(config).length > 0 ? new StatusMap(config) : fallback;
}
```

Add the export to `packages/outpost/shared/src/sync/index.ts:4`:

```typescript
export {
    StatusMap,
    createGitHubStatusMap,
    createLinearStatusMap,
    loadStatusMap,
} from './status-map.js';
export type { StatusMappingConfig, StatusMapDb } from './status-map.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/outpost/shared && pnpm test -- status-map.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/outpost/shared/src/sync/status-map.ts packages/outpost/shared/src/sync/index.ts packages/outpost/shared/src/sync/__tests__/status-map.test.ts
git commit -m "feat(sync): load status map from persisted mapping config"
```

---

## Task 3: Let `initializeSyncEngine` accept a pre-loaded status map

**Files:**

- Modify: `packages/outpost/shared/src/sync/init.ts`
- Create: `packages/outpost/shared/src/sync/__tests__/init.test.ts`

**Interfaces:**

- Consumes: `loadStatusMap`, `StatusMapDb` from Task 2 (imported by the caller, not by `init.ts` itself — `init.ts` just accepts an already-built `StatusMap`).
- Produces: `InitOptions.statusMapOverride?: StatusMap` — Task 4's `buildSyncEngine` passes this in.

- [ ] **Step 1: Write the failing test**

Create `packages/outpost/shared/src/sync/__tests__/init.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { initializeSyncEngine } from '../init.js';
import { StatusMap } from '../status-map.js';
import { TicketStatus } from '../../types.js';

function makeIdentityDeps() {
    return {
        externalIdentity: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
            findMany: vi.fn(),
            create: vi.fn(),
        },
    };
}

describe('initializeSyncEngine', () => {
    it('registers no adapters when Linear env vars are missing', () => {
        const engine = initializeSyncEngine({
            deps: { prisma: {} as never, createJob: vi.fn() },
            identityDeps: makeIdentityDeps(),
            env: {},
        });

        expect(engine.getPlugin('linear')).toBeUndefined();
    });

    it('registers the Linear adapter with the default status map when no override is given', () => {
        const engine = initializeSyncEngine({
            deps: { prisma: {} as never, createJob: vi.fn() },
            identityDeps: makeIdentityDeps(),
            env: { LINEAR_API_KEY: 'key', LINEAR_TEAM_ID: 'team' },
        });

        expect(engine.getPlugin('linear')).toBeDefined();
    });

    it('uses the provided statusMapOverride instead of the hardcoded default', () => {
        const customMap = new StatusMap({ Custom: TicketStatus.WAITING_ON_TEAM });

        const engine = initializeSyncEngine({
            deps: { prisma: {} as never, createJob: vi.fn() },
            identityDeps: makeIdentityDeps(),
            env: { LINEAR_API_KEY: 'key', LINEAR_TEAM_ID: 'team' },
            statusMapOverride: customMap,
        });

        const plugin = engine.getPlugin('linear');
        expect(plugin).toBeDefined();
        // mapStatusToOutpost is the InternalTracker interface method the adapter
        // delegates to its injected StatusMap
        expect(plugin!.mapStatusToOutpost('Custom')).toBe(TicketStatus.WAITING_ON_TEAM);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/outpost/shared && pnpm test -- init.test.ts`
Expected: FAIL on the third test — `statusMapOverride` is not a recognized option, so the Linear adapter uses `createLinearStatusMap()` regardless, and `plugin.mapStatusToOutpost('Custom')` returns the fallback (`OPEN`), not `WAITING_ON_TEAM`.

- [ ] **Step 3: Implement `statusMapOverride`**

Modify `packages/outpost/shared/src/sync/init.ts`:

```typescript
interface InitOptions {
    /** Override for dependency injection (testing). */
    deps: SyncEngineDeps;
    /** Override for identity mapper deps (testing). */
    identityDeps?: IdentityMapperDeps;
    /** Override for environment variables (testing). */
    env?: Record<string, string | undefined>;
    /** Pre-built StatusMap to use instead of createLinearStatusMap(). */
    statusMapOverride?: StatusMap;
}
```

And in the Linear adapter construction, replace `statusMap: createLinearStatusMap(),` with:

```typescript
                statusMap: options.statusMapOverride ?? createLinearStatusMap(),
```

Add `StatusMap` to the existing import from `./status-map.js`:

```typescript
import { createLinearStatusMap, StatusMap } from './status-map.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/outpost/shared && pnpm test -- init.test.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/outpost/shared/src/sync/init.ts packages/outpost/shared/src/sync/__tests__/init.test.ts
git commit -m "feat(sync): support statusMapOverride in initializeSyncEngine"
```

---

## Task 4: Wire the worker to register the Linear adapter

**Files:**

- Create: `apps/worker/src/build-sync-engine.ts`
- Create: `apps/worker/src/__tests__/build-sync-engine.test.ts`
- Modify: `apps/worker/src/index.ts:37-41`

**Interfaces:**

- Consumes: `loadStatusMap`, `initializeSyncEngine`, `SyncEngine` from `@copilotkit/outpost/shared` (Tasks 2 & 3); `prisma` from `@copilotkit/outpost/db`; `createJob` from `@copilotkit/outpost/queue`.
- Produces: `export async function buildSyncEngine(): Promise<SyncEngine>` — `index.ts` calls this in place of the bare `new SyncEngine(...)`.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/__tests__/build-sync-engine.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoadStatusMap = vi.fn();
const mockInitializeSyncEngine = vi.fn();

vi.mock('@copilotkit/outpost/shared', () => ({
    loadStatusMap: (...args: unknown[]) => mockLoadStatusMap(...args),
    initializeSyncEngine: (...args: unknown[]) => mockInitializeSyncEngine(...args),
}));

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: { systemConfig: {}, externalIdentity: {} },
}));

vi.mock('@copilotkit/outpost/queue', () => ({
    createJob: vi.fn(),
}));

import { buildSyncEngine } from '../build-sync-engine.js';
import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';

describe('buildSyncEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads the Linear status map and passes it into initializeSyncEngine', async () => {
        const fakeStatusMap = { toOutpost: vi.fn() };
        const fakeEngine = { getPlugin: vi.fn() };
        mockLoadStatusMap.mockResolvedValue(fakeStatusMap);
        mockInitializeSyncEngine.mockReturnValue(fakeEngine);

        const result = await buildSyncEngine();

        expect(mockLoadStatusMap).toHaveBeenCalledWith('linear', prisma);
        expect(mockInitializeSyncEngine).toHaveBeenCalledWith({
            deps: { prisma, createJob },
            identityDeps: prisma,
            statusMapOverride: fakeStatusMap,
        });
        expect(result).toBe(fakeEngine);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && pnpm test -- build-sync-engine.test.ts`
Expected: FAIL — `Cannot find module '../build-sync-engine.js'`.

- [ ] **Step 3: Implement `buildSyncEngine`**

Create `apps/worker/src/build-sync-engine.ts`:

```typescript
/**
 * Builds the SyncEngine for the TRACKER_SYNC handler, with the Linear
 * adapter registered using the persisted status-map config (falling back
 * to the hardcoded default when nothing is persisted). GitHub adapter
 * registration is not wired here — it needs an authenticated Octokit
 * instance that currently only exists inside apps/github-app.
 */

import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';
import { loadStatusMap, initializeSyncEngine, type SyncEngine } from '@copilotkit/outpost/shared';

export async function buildSyncEngine(): Promise<SyncEngine> {
    const statusMap = await loadStatusMap('linear', prisma as never);

    return initializeSyncEngine({
        deps: { prisma: prisma as never, createJob: createJob as never },
        identityDeps: prisma as never,
        statusMapOverride: statusMap,
    });
}
```

Modify `apps/worker/src/index.ts` — replace lines 37-41:

```typescript
// ─── Build SyncEngine for TRACKER_SYNC handler ────────────────────────────

const syncEngine = new SyncEngine({ prisma: prisma as any, createJob: createJob as any });
```

with:

```typescript
// ─── Build SyncEngine for TRACKER_SYNC handler ────────────────────────────

const syncEngine = await buildSyncEngine();
```

Add the import (top of file, near the other `@copilotkit/outpost/shared` import) and remove the now-unused `SyncEngine` import from `@copilotkit/outpost/shared` since it's no longer constructed directly in this file:

```typescript
import { buildSyncEngine } from './build-sync-engine.js';
```

(Delete `import { SyncEngine } from '@copilotkit/outpost/shared';` — `buildSyncEngine` owns that dependency now.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && pnpm test -- build-sync-engine.test.ts`
Expected: PASS.

Also run the full worker build to confirm the top-level `await` and import changes compile cleanly:

Run: `cd apps/worker && pnpm build`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/build-sync-engine.ts apps/worker/src/__tests__/build-sync-engine.test.ts apps/worker/src/index.ts
git commit -m "fix(worker): register Linear sync adapter (was never wired up)"
```

---

## Task 5: Bulk force-sync

**Files:**

- Modify: `apps/web/src/app/api/sync/force/route.ts`
- Modify: `apps/web/src/__tests__/sync-api.test.ts:274-306` (the `describe('POST /api/sync/force', ...)` block)

**Interfaces:**

- Consumes: `createJob(JobType.TRACKER_SYNC, payload)` from `@copilotkit/outpost/queue` (already mocked in this test file as `mockCreateJob`); `prisma.ticketExternalLink.findMany` (new mock needed).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Write the failing tests**

Replace the `describe('POST /api/sync/force', ...)` block (lines 274-306 of `apps/web/src/__tests__/sync-api.test.ts`) with:

```typescript
describe('POST /api/sync/force', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1', 'ADMIN'));
    });

    it('enqueues status_change and priority_change jobs for every ticket linked to the plugin', async () => {
        mockSyncEventFindFirst.mockResolvedValue({ id: 'se-1' });
        mockTicketExternalLinkFindMany.mockResolvedValue([
            {
                ticketId: 't-1',
                plugin: 'linear',
                ticket: { id: 't-1', status: 'OPEN', priority: 'HIGH' },
            },
            {
                ticketId: 't-2',
                plugin: 'linear',
                ticket: { id: 't-2', status: 'RESOLVED', priority: 'LOW' },
            },
        ]);

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'linear' });
        const res = await forceSync(req as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({ queued: 2, jobs: 4 });
        expect(mockCreateJob).toHaveBeenCalledTimes(4);
        expect(mockCreateJob).toHaveBeenCalledWith('TRACKER_SYNC', {
            ticketId: 't-1',
            targetPlugin: 'linear',
            action: 'status_change',
            changeData: { status: 'OPEN' },
        });
        expect(mockCreateJob).toHaveBeenCalledWith('TRACKER_SYNC', {
            ticketId: 't-1',
            targetPlugin: 'linear',
            action: 'priority_change',
            changeData: { priority: 'HIGH' },
        });
    });

    it('returns zero counts and does not call createJob when no tickets are linked', async () => {
        mockSyncEventFindFirst.mockResolvedValue({ id: 'se-1' });
        mockTicketExternalLinkFindMany.mockResolvedValue([]);

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'linear' });
        const res = await forceSync(req as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({ queued: 0, jobs: 0 });
        expect(mockCreateJob).not.toHaveBeenCalled();
    });

    it('syncs only the given ticket when ticketId is provided', async () => {
        mockSyncEventFindFirst.mockResolvedValue({ id: 'se-1' });
        mockTicketExternalLinkFindMany.mockResolvedValue([
            {
                ticketId: 't-1',
                plugin: 'linear',
                ticket: { id: 't-1', status: 'OPEN', priority: 'HIGH' },
            },
        ]);

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', {
            plugin: 'linear',
            ticketId: 't-1',
        });
        const res = await forceSync(req as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({ queued: 1, jobs: 2 });
        expect(mockTicketExternalLinkFindMany).toHaveBeenCalledWith({
            where: { plugin: 'linear', ticketId: 't-1' },
            include: { ticket: true },
        });
    });

    it('returns 404 for unknown plugin', async () => {
        mockSyncEventFindFirst.mockResolvedValue(null);

        const req = makeJsonRequest('http://localhost:3000/api/sync/force', { plugin: 'unknown' });
        const res = await forceSync(req as never);

        expect(res.status).toBe(404);
        expect(mockTicketExternalLinkFindMany).not.toHaveBeenCalled();
    });

    it('rejects when plugin is missing', async () => {
        const req = makeJsonRequest('http://localhost:3000/api/sync/force', {});
        const res = await forceSync(req as never);

        expect(res.status).toBe(400);
    });
});
```

Add the new mock near the other `mock*` declarations at the top of the file:

```typescript
const mockTicketExternalLinkFindMany = vi.fn();
```

Add `ticketExternalLink` alongside `syncEvent`/`externalIdentity`/`systemConfig` inside the `prisma` mock object:

```typescript
        ticketExternalLink: {
            findMany: (...args: unknown[]) => mockTicketExternalLinkFindMany(...args),
        },
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm test -- sync-api.test.ts`
Expected: FAIL — all `POST /api/sync/force` bulk/ticketId tests fail with 501 (route still returns "not yet implemented").

- [ ] **Step 3: Implement bulk force-sync**

Replace the entire contents of `apps/web/src/app/api/sync/force/route.ts` with:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { createJob, JobType } from '@copilotkit/outpost/queue';
import { requireAdmin } from '@/lib/require-admin';

/**
 * POST /api/sync/force
 *
 * Trigger a force sync for a specific system plugin. Enqueues a
 * TRACKER_SYNC job per changed field (status, priority) for every ticket
 * currently linked to that plugin, or just one ticket when `ticketId`
 * is given. Ticket has no tags/labels field, so label_change is not
 * part of a resync.
 *
 * Body: { plugin: string, ticketId?: string }
 */
export async function POST(request: NextRequest) {
    const { error } = await requireAdmin();
    if (error) return error;

    try {
        const body = await request.json();
        const plugin = body.plugin;
        const ticketId = typeof body.ticketId === 'string' ? body.ticketId : undefined;

        if (!plugin || typeof plugin !== 'string') {
            return NextResponse.json({ error: 'plugin is required' }, { status: 400 });
        }

        const knownPlugin = await prisma.syncEvent.findFirst({
            where: {
                OR: [{ sourcePlugin: plugin }, { targetPlugin: plugin }],
            },
        });

        if (!knownPlugin) {
            return NextResponse.json({ error: `Unknown plugin: ${plugin}` }, { status: 404 });
        }

        const links = await prisma.ticketExternalLink.findMany({
            where: ticketId ? { plugin, ticketId } : { plugin },
            include: { ticket: true },
        });

        let jobs = 0;
        for (const link of links) {
            await createJob(JobType.TRACKER_SYNC, {
                ticketId: link.ticket.id,
                targetPlugin: plugin,
                action: 'status_change',
                changeData: { status: link.ticket.status },
            });
            jobs += 1;

            await createJob(JobType.TRACKER_SYNC, {
                ticketId: link.ticket.id,
                targetPlugin: plugin,
                action: 'priority_change',
                changeData: { priority: link.ticket.priority },
            });
            jobs += 1;
        }

        return NextResponse.json({ queued: links.length, jobs });
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm test -- sync-api.test.ts`
Expected: PASS — all tests in the file green, including the pre-existing `GET/PUT /api/sync/mappings` ones from Task 1.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/sync/force/route.ts apps/web/src/__tests__/sync-api.test.ts
git commit -m "feat(sync): implement bulk force-sync for all tickets linked to a plugin"
```

---

## Final Verification

- [ ] **Run the full test suite for every touched package**

```bash
cd apps/web && pnpm test
cd ../../packages/outpost/shared && pnpm test
cd ../../../apps/worker && pnpm test
```

Expected: all green, no regressions in any of the three packages.

- [ ] **Build check**

```bash
cd apps/web && pnpm build
cd ../../apps/worker && pnpm build
cd ../../packages/outpost/shared && pnpm build
```

Expected: all exit 0.
