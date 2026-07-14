# Sync Mapping Persistence + Bulk Force-Sync

## Context

The Bidirectional Sync feature (GitHub ↔ Linear ↔ Outpost) is already built: `SyncEngine`,
plugin adapters, `TRACKER_SYNC` job handler wired into `apps/worker`, triggers, echo
detection, and a `/sync` dashboard. Two endpoints behind that dashboard are still 501 stubs:

- `PUT /api/sync/mappings` (`apps/web/src/app/api/sync/mappings/route.ts:111`) — validates
  the body but never persists it. `GET` always returns hardcoded `DEFAULT_*` constants.
- `POST /api/sync/force` (`apps/web/src/app/api/sync/force/route.ts:43`) — only handles a
  single ticket's sync (currently unimplemented for that path too); has no bulk/full mode.

This spec closes both gaps without introducing new architecture — reusing the existing
`SystemConfig` key-value table and the existing `TRACKER_SYNC` job/handler.

## Goals

1. Editing status/priority/label mappings in the `/sync` dashboard actually persists, and
   actually changes what the running sync worker does — not just a UI-only save.
2. An admin can trigger a full resync of every ticket linked to a given plugin (Linear or
   GitHub) from the dashboard, without a new job type.

## Non-goals

- No new job type. Bulk sync reuses `TRACKER_SYNC` per linked ticket.
- No mapping-config versioning/audit trail — a single current config, overwritten on save.
- No UI changes — `apps/web/src/components/sync/*` already renders/edits this data; only
  the API routes and the worker's config loading change.

## Design

### 1. Mapping persistence

Store the full mapping config as one JSON row in the existing `SystemConfig` model
(`packages/outpost/db/prisma/schema.prisma:430-434`, no migration needed):

- `key`: `"sync.mappingConfig"`
- `value`: JSON string of `{ statusMappings, priorityMappings, labelRules }` (same shape the
  route already validates)

**`GET /api/sync/mappings`**: read the `SystemConfig` row. If present, parse and return it
(merged with identity mappings from `ExternalIdentity`, as today). If absent, fall back to
the current `DEFAULT_STATUS_MAPPINGS` / `DEFAULT_PRIORITY_MAPPINGS` / `DEFAULT_LABEL_RULES`
constants — unchanged behavior for a fresh install.

**`PUT /api/sync/mappings`**: after existing validation, `prisma.systemConfig.upsert()` the
row. Return the saved config. Remove the 501.

**Wiring into the running sync engine** (the part that makes this real, not cosmetic):
today `createLinearStatusMap()` / `createGitHubStatusMap()` in
`packages/outpost/shared/src/sync/status-map.ts:69-86` are hardcoded factories, called once
at worker boot in `apps/worker/src/index.ts`. Add:

```ts
// status-map.ts
export async function loadStatusMap(plugin: 'linear' | 'github'): Promise<StatusMap>
```

which reads `SystemConfig["sync.mappingConfig"]`, extracts `statusMappings[plugin]` if
present, and builds a `StatusMap` from it; falls back to `createLinearStatusMap()` /
`createGitHubStatusMap()` if the config row or plugin key is missing. `apps/worker/src/index.ts`
calls this at startup instead of the hardcoded factories directly.

Priority mappings and label rules are read/written the same way but are not yet consumed
elsewhere in the sync engine — persisting them is still correct (single source of truth,
dashboard round-trips real data) but wiring them into `executePush`'s priority/label
handling is out of scope here (they're already applied as literal values passed by the
caller, not looked up from a plugin-level map, per `tracker-sync.ts:181-188`).

### 2. Bulk force-sync

`POST /api/sync/force` body: `{ plugin: string, ticketId?: string }`.

- `ticketId` present → sync that one ticket (existing single-ticket path; still needs the
  same "current values" push described below, since it's currently also unimplemented).
- `ticketId` absent → bulk mode:
  1. `prisma.ticketExternalLink.findMany({ where: { plugin }, include: { ticket: true } })`
  2. For each linked ticket, enqueue three `TRACKER_SYNC` jobs (reusing the existing job
     type/handler, untouched) via `createJob`:
     - `action: 'status_change'`, `changeData: { status: ticket.status }`
     - `action: 'priority_change'`, `changeData: { priority: ticket.priority }`
     - `action: 'label_change'`, `changeData: { labels: ticket.tags }` (skip if empty)
  3. Return `{ queued: <ticket count>, jobs: <job count> }`.

The route only inserts jobs (cheap Postgres writes); the worker performs the actual pushes
asynchronously, so this stays fast even for a few hundred linked tickets. No pagination
needed at current expected volume; if a workspace ever has thousands of linked tickets,
that's a future problem, not one to solve speculatively here.

Unknown-plugin handling (`404` if no `SyncEvent` mentions the plugin) is unchanged.

## Testing

Per repo convention (Vitest, red-green, webhook/job tests use mocked Prisma):

- `mappings/route.ts`: test GET falls back to defaults when no `SystemConfig` row exists;
  test PUT upserts and GET reflects the saved value; test PUT validation still rejects
  missing `statusMappings`/`priorityMappings`.
- `status-map.ts` `loadStatusMap`: test it builds from a mocked `SystemConfig` row; test it
  falls back to the hardcoded factory when the row or plugin key is absent.
- `force/route.ts`: test bulk mode enqueues 3 jobs per linked ticket (mock
  `ticketExternalLink.findMany` returning N tickets, assert `createJob` called 3N times);
  test single-ticket mode still works; test unknown plugin still 404s; test empty `tags`
  skips the label job.

## Files touched

- `apps/web/src/app/api/sync/mappings/route.ts`
- `apps/web/src/app/api/sync/force/route.ts`
- `packages/outpost/shared/src/sync/status-map.ts`
- `apps/worker/src/index.ts`
- New/updated test files alongside each of the above per existing `__tests__/` convention
