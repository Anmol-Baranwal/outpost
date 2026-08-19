# Needs Human Reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-empty My Tasks panel and the meaningless SLA Breaches card with one honest signal — tickets where the AI answered and no team member has followed up.

**Architecture:** `Message` gains `authorType` and `userId`, written at ingest time by `InboundHandler` (which already computes team membership and throws it away) and backfilled for existing rows. A new API route selects tickets whose newest AI message has no later `TEAM` message. The dashboard panel and the third stat card both read that route.

**Tech Stack:** Prisma + PostgreSQL, Next.js 15 App Router, React 19, TypeScript, Vitest.

This is PR 2 of three from `docs/superpowers/specs/2026-07-31-dashboard-usability-design.md`. Branch: `feat/dashboard-needs-human-reply`, cut fresh off `main` — it does not depend on PR 1.

## Global Constraints

- A reply from the **reporter** does not clear a ticket from the list. Only a `TEAM` message newer than the newest AI message does. An unanswered "that didn't work" is the case most worth surfacing.
- The backfill **reports** rows it cannot resolve rather than defaulting them to `COMMUNITY`. Guessing here fabricates the exact signal the feature reads.
- `authorType` ships **nullable**, is backfilled, and only then becomes required. Prod bots keep writing through the whole sequence; old code simply leaves the column null.
- `slaBreaches` is removed from the stats response in this PR, together with the card that reads it. Per-customer contractual SLAs are tracked in §8 Sales of the Notion roadmap and are out of scope here.
- Expected result on the prod-data clone (`localhost:5433`): **50 tickets**, with `TKT-AD8S9CHR` absent because a team member replied to it.
- Every code change ships with a test. No exceptions.

---

## File Structure

- **Modify** `packages/outpost/db/prisma/schema.prisma` — `MessageAuthorType` enum, two `Message` fields, one index.
- **Create** `packages/outpost/db/prisma/migrations/<timestamp>_add_message_author_type/migration.sql` — generated, not hand-written.
- **Modify** `packages/outpost/shared/src/platforms/inbound.ts` — persist `authorType` + `userId` on both write paths.
- **Create** `packages/outpost/shared/src/messages/author-type.ts` — the author-string parser, shared by the backfill and its tests.
- **Create** `scripts/backfill-message-author-type.ts` — one-shot backfill.
- **Create** `apps/web/src/app/api/dashboard/needs-human-reply/route.ts` — the query.
- **Create** `apps/web/src/components/dashboard/needs-human-reply.tsx` — the panel.
- **Delete** `apps/web/src/components/dashboard/my-tasks.tsx` and `apps/web/src/app/api/dashboard/my-tasks/route.ts`.
- **Modify** `apps/web/src/components/dashboard/sla-health.tsx` — third card swap, `—` on no resolution data.
- **Modify** `apps/web/src/app/dashboard/page.tsx` — swap the panel, feed the new count.
- **Modify** `apps/web/src/app/api/dashboard/stats/route.ts` — drop `slaBreaches`.

---

### Task 1: Schema — authorType and userId on Message

**Files:**
- Modify: `packages/outpost/db/prisma/schema.prisma:99-116` (Message model), `:118-122` (after MessageType)

**Interfaces:**
- Produces: `MessageAuthorType` enum with members `TEAM`, `COMMUNITY`, `AI`, `SYSTEM`; `Message.authorType` (nullable `MessageAuthorType`); `Message.userId` (nullable `String`, relation to `User`).

- [ ] **Step 1: Edit the schema**

In `packages/outpost/db/prisma/schema.prisma`, add these fields to `model Message` after `type` (line 105):

```prisma
    authorType        MessageAuthorType?  // null only for pre-backfill rows
    userId            String?
    user              User?       @relation(fields: [userId], references: [id])
```

Add this index to the same model, beside the existing two:

```prisma
    @@index([ticketId, authorType, createdAt])
```

Add the enum immediately after `enum MessageType` (line 122):

```prisma
/// Who wrote a message. Distinct from MessageType, which describes the
/// transport: a team member's reply and a community reply both arrive as
/// type=USER and are otherwise indistinguishable.
enum MessageAuthorType {
    TEAM
    COMMUNITY
    AI
    SYSTEM
}
```

Add the back-relation to `model User` (find it in the same file) so Prisma validates:

```prisma
    messages        Message[]
```

- [ ] **Step 2: Generate the migration**

Run against the local clone, never production:

```bash
DATABASE_URL="postgresql://outpost:outpost@localhost:5433/outpost?schema=public" \
  pnpm --filter @copilotkit/outpost exec prisma migrate dev \
  --schema=db/prisma/schema.prisma --name add_message_author_type
```

Expected: a new directory under `db/prisma/migrations/`, and `ALTER TABLE "Message" ADD COLUMN "authorType"` in its `migration.sql`. Read the generated SQL and confirm it contains **no** `DROP` statement.

- [ ] **Step 3: Verify the column exists and every row is null**

```bash
docker exec outpost-pg18-prodclone psql -U outpost -d outpost -Atc \
  'select count(*), count("authorType") from "Message";'
```

Expected: `191|0` — every message present, none classified yet.

- [ ] **Step 4: Commit**

```bash
git add packages/outpost/db/prisma/schema.prisma packages/outpost/db/prisma/migrations
git commit -m "feat(db): Message.authorType + userId

A team member's reply and a community reply both arrive as type=USER and
are otherwise indistinguishable, so nothing can ask 'did a human on our
side answer this'. Nullable for now; backfilled next, then required."
```

---

### Task 2: Author-string parser

**Files:**
- Create: `packages/outpost/shared/src/messages/author-type.ts`
- Test: `packages/outpost/shared/src/__tests__/author-type.test.ts`

**Interfaces:**
- Produces, used by Task 3:
  - `parseAuthorExternalId(author: string): string | null` — pulls `66887028` out of `"NathanTarbert (66887028)"`, returns null when the string has no parenthesised id.
  - `classifyExisting(input: { type: string; isAiGenerated: boolean; author: string; isTeam: boolean | null }): 'TEAM' | 'COMMUNITY' | 'AI' | 'SYSTEM' | null` — returns null when membership is unknown, so the caller can report rather than guess.

- [ ] **Step 1: Write the failing tests**

Create `packages/outpost/shared/src/__tests__/author-type.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseAuthorExternalId, classifyExisting } from '../messages/author-type.js';

describe('parseAuthorExternalId', () => {
    it('extracts a numeric GitHub id', () => {
        expect(parseAuthorExternalId('NathanTarbert (66887028)')).toBe('66887028');
    });

    it('extracts a Discord snowflake', () => {
        expect(parseAuthorExternalId('generaljerel (754917340948332604)')).toBe('754917340948332604');
    });

    it('extracts a non-numeric handle used as an id', () => {
        expect(parseAuthorExternalId('jerelvelarde (jerelvelarde)')).toBe('jerelvelarde');
    });

    it('returns null with no parenthesised id', () => {
        expect(parseAuthorExternalId('Outpost AI')).toBeNull();
        expect(parseAuthorExternalId('System')).toBeNull();
        expect(parseAuthorExternalId('')).toBeNull();
    });

    it('takes the last group when the display name itself has parentheses', () => {
        expect(parseAuthorExternalId('Foo (Bar) (12345)')).toBe('12345');
    });
});

describe('classifyExisting', () => {
    it('classifies AI-generated messages as AI regardless of type', () => {
        expect(classifyExisting({
            type: 'BOT', isAiGenerated: true, author: 'Outpost AI', isTeam: null,
        })).toBe('AI');
    });

    it('classifies SYSTEM messages as SYSTEM', () => {
        expect(classifyExisting({
            type: 'SYSTEM', isAiGenerated: false, author: 'System', isTeam: null,
        })).toBe('SYSTEM');
    });

    it('classifies a known team sender as TEAM', () => {
        expect(classifyExisting({
            type: 'USER', isAiGenerated: false, author: 'NathanTarbert (66887028)', isTeam: true,
        })).toBe('TEAM');
    });

    it('classifies a known non-team sender as COMMUNITY', () => {
        expect(classifyExisting({
            type: 'USER', isAiGenerated: false, author: 'nagasatish007 (25077064)', isTeam: false,
        })).toBe('COMMUNITY');
    });

    it('returns null when membership is unknown, rather than guessing COMMUNITY', () => {
        expect(classifyExisting({
            type: 'USER', isAiGenerated: false, author: 'someone (999)', isTeam: null,
        })).toBeNull();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @copilotkit/outpost exec vitest run shared/src/__tests__/author-type.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/outpost/shared/src/messages/author-type.ts`:

```typescript
/**
 * Classification helpers for Message.authorType.
 *
 * Messages written before the authorType column existed store their sender
 * only as a display string — `"NathanTarbert (66887028)"`. These helpers
 * recover the external id so the backfill can resolve it to a User and then
 * a TeamMember.
 */

export type MessageAuthorTypeValue = 'TEAM' | 'COMMUNITY' | 'AI' | 'SYSTEM';

/** Trailing `(...)` group of an author label, or null when absent. */
export function parseAuthorExternalId(author: string): string | null {
    const match = author.match(/\(([^()]+)\)\s*$/);
    return match ? match[1] : null;
}

/**
 * Classify a pre-existing message row.
 *
 * `isTeam` is the caller's resolved membership lookup: true, false, or null
 * when it could not be determined. Null in yields null out — an unresolvable
 * author must be reported, not silently recorded as COMMUNITY, because that
 * would fabricate the signal the dashboard reads.
 */
export function classifyExisting(input: {
    type: string;
    isAiGenerated: boolean;
    author: string;
    isTeam: boolean | null;
}): MessageAuthorTypeValue | null {
    if (input.isAiGenerated) return 'AI';
    if (input.type === 'SYSTEM') return 'SYSTEM';
    if (input.isTeam === null) return null;
    return input.isTeam ? 'TEAM' : 'COMMUNITY';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @copilotkit/outpost exec vitest run shared/src/__tests__/author-type.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/outpost/shared/src/messages/author-type.ts packages/outpost/shared/src/__tests__/author-type.test.ts
git commit -m "feat(shared): author-string parser for message classification"
```

---

### Task 3: Backfill existing messages

**Files:**
- Create: `scripts/backfill-message-author-type.ts`
- Test: `scripts/__tests__/backfill-message-author-type.test.ts`

**Interfaces:**
- Consumes: `parseAuthorExternalId`, `classifyExisting` from Task 2.
- Produces: `backfillAuthorTypes(prisma): Promise<{ updated: Record<string, number>; unresolved: Array<{ id: string; author: string }> }>` — exported so the test can drive it with a stubbed client, with a CLI wrapper under the usual `import.meta.url` guard.

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/backfill-message-author-type.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { backfillAuthorTypes } from '../backfill-message-author-type.js';

function stubPrisma(messages: unknown[], users: Record<string, { email: string }>, teamEmails: string[]) {
    return {
        message: {
            findMany: vi.fn().mockResolvedValue(messages),
            update: vi.fn().mockResolvedValue({}),
        },
        user: {
            findFirst: vi.fn().mockImplementation(({ where }: { where: { externalId: string } }) =>
                Promise.resolve(
                    users[where.externalId]
                        ? { id: `u-${where.externalId}`, email: users[where.externalId].email }
                        : null,
                ),
            ),
        },
        teamMember: {
            findUnique: vi.fn().mockImplementation(({ where }: { where: { email: string } }) =>
                Promise.resolve(teamEmails.includes(where.email) ? { id: 'tm-1' } : null),
            ),
        },
    };
}

describe('backfillAuthorTypes', () => {
    it('classifies AI, system, team, and community rows', async () => {
        const prisma = stubPrisma(
            [
                { id: 'm1', type: 'BOT', isAiGenerated: true, author: 'Outpost AI' },
                { id: 'm2', type: 'SYSTEM', isAiGenerated: false, author: 'System' },
                { id: 'm3', type: 'USER', isAiGenerated: false, author: 'Nathan (66887028)' },
                { id: 'm4', type: 'USER', isAiGenerated: false, author: 'rando (25077064)' },
            ],
            { '66887028': { email: 'nathan@copilotkit.ai' }, '25077064': { email: 'r@x.com' } },
            ['nathan@copilotkit.ai'],
        );

        const result = await backfillAuthorTypes(prisma as never);

        expect(result.updated).toEqual({ AI: 1, SYSTEM: 1, TEAM: 1, COMMUNITY: 1 });
        expect(result.unresolved).toEqual([]);
        expect(prisma.message.update).toHaveBeenCalledTimes(4);
    });

    it('reports unresolvable authors instead of defaulting them to COMMUNITY', async () => {
        const prisma = stubPrisma(
            [{ id: 'm9', type: 'USER', isAiGenerated: false, author: 'ghost (00000)' }],
            {},
            [],
        );

        const result = await backfillAuthorTypes(prisma as never);

        expect(result.unresolved).toEqual([{ id: 'm9', author: 'ghost (00000)' }]);
        expect(prisma.message.update).not.toHaveBeenCalled();
    });

    it('links userId when the sender resolves to a User', async () => {
        const prisma = stubPrisma(
            [{ id: 'm3', type: 'USER', isAiGenerated: false, author: 'Nathan (66887028)' }],
            { '66887028': { email: 'nathan@copilotkit.ai' } },
            ['nathan@copilotkit.ai'],
        );

        await backfillAuthorTypes(prisma as never);

        expect(prisma.message.update).toHaveBeenCalledWith({
            where: { id: 'm3' },
            data: { authorType: 'TEAM', userId: 'u-66887028' },
        });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run scripts/__tests__/backfill-message-author-type.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `scripts/backfill-message-author-type.ts`:

```typescript
/**
 * One-shot backfill for Message.authorType and Message.userId.
 *
 * Pre-existing rows record their sender only as a display string. This
 * recovers the external id, resolves it through User -> TeamMember, and
 * classifies each row. Rows it cannot resolve are REPORTED, never defaulted:
 * marking an unknown sender COMMUNITY would invent the exact signal the
 * Needs Human Reply panel reads.
 *
 * Run:
 *   DATABASE_URL=... pnpm exec tsx scripts/backfill-message-author-type.ts
 */

import { PrismaClient } from '@prisma/client';
import { parseAuthorExternalId, classifyExisting } from '@copilotkit/outpost/shared';

interface BackfillResult {
    updated: Record<string, number>;
    unresolved: Array<{ id: string; author: string }>;
}

export async function backfillAuthorTypes(prisma: PrismaClient): Promise<BackfillResult> {
    const messages = await prisma.message.findMany({
        where: { authorType: null },
        select: { id: true, type: true, isAiGenerated: true, author: true },
    });

    const updated: Record<string, number> = {};
    const unresolved: Array<{ id: string; author: string }> = [];

    for (const message of messages) {
        let isTeam: boolean | null = null;
        let userId: string | null = null;

        // Only USER-authored, non-AI rows need a membership lookup; AI and
        // SYSTEM rows classify on their own.
        if (!message.isAiGenerated && message.type !== 'SYSTEM') {
            const externalId = parseAuthorExternalId(message.author);
            if (externalId) {
                const user = await prisma.user.findFirst({ where: { externalId } });
                if (user) {
                    userId = user.id;
                    const member = await prisma.teamMember.findUnique({
                        where: { email: user.email },
                    });
                    isTeam = member !== null;
                }
            }
        }

        const authorType = classifyExisting({
            type: message.type,
            isAiGenerated: message.isAiGenerated,
            author: message.author,
            isTeam,
        });

        if (!authorType) {
            unresolved.push({ id: message.id, author: message.author });
            continue;
        }

        await prisma.message.update({
            where: { id: message.id },
            data: { authorType, ...(userId ? { userId } : {}) },
        });

        updated[authorType] = (updated[authorType] ?? 0) + 1;
    }

    return { updated, unresolved };
}

async function main() {
    const prisma = new PrismaClient();
    try {
        const { updated, unresolved } = await backfillAuthorTypes(prisma);
        console.log('Backfilled:', updated);
        if (unresolved.length > 0) {
            console.log(`\n${unresolved.length} row(s) left unclassified — decide these by hand:`);
            for (const row of unresolved) {
                console.log(`  ${row.id}  ${row.author}`);
            }
        }
    } finally {
        await prisma.$disconnect();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
```

Export the two helpers from `packages/outpost/shared/src/index.ts` so the script's import resolves — add `export * from './messages/author-type.js';` alongside the existing exports.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run scripts/__tests__/backfill-message-author-type.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the backfill against the clone**

```bash
pnpm --filter @copilotkit/outpost build:shared
DATABASE_URL="postgresql://outpost:outpost@localhost:5433/outpost?schema=public" \
  pnpm exec tsx scripts/backfill-message-author-type.ts
```

Expected on the clone: roughly `{ AI: 68, SYSTEM: 122, TEAM: n, COMMUNITY: m }` where `n + m ≈ 69`. Report any unresolved rows in the task summary rather than silently accepting them.

Confirm none remain null:

```bash
docker exec outpost-pg18-prodclone psql -U outpost -d outpost -Atc \
  'select "authorType", count(*) from "Message" group by 1 order by 2 desc;'
```

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-message-author-type.ts scripts/__tests__ packages/outpost/shared/src/index.ts
git commit -m "feat(scripts): backfill Message.authorType

Unresolvable authors are reported, not defaulted to COMMUNITY — guessing
would fabricate the signal the dashboard reads."
```

---

### Task 4: InboundHandler persists authorType

**Files:**
- Modify: `packages/outpost/shared/src/platforms/inbound.ts:173-186` (new-ticket message), `:230-239` (reply message)
- Test: `packages/outpost/shared/src/__tests__/platforms-inbound.test.ts`

**Interfaces:**
- Consumes: the schema from Task 1.
- Produces: every message written by `InboundHandler` carries `authorType` and `userId`.

- [ ] **Step 1: Write the failing tests**

Read `packages/outpost/shared/src/__tests__/platforms-inbound.test.ts` first and follow its existing stub setup — it already mocks a Prisma-shaped client and drives `handleInboundMessage`. Add tests asserting:

```typescript
    it('records a community sender as COMMUNITY with a linked userId', async () => {
        // ...existing arrangement for a non-team sender, then:
        const created = prisma.message.create.mock.calls[0][0].data;
        expect(created.authorType).toBe('COMMUNITY');
        expect(created.userId).toBeTruthy();
    });

    it('records a team sender as TEAM', async () => {
        // ...existing arrangement for a team sender, then:
        const created = prisma.message.create.mock.calls[0][0].data;
        expect(created.authorType).toBe('TEAM');
    });

    it('records authorType on replies to an existing ticket, not just new tickets', async () => {
        // ...existing reply arrangement, then assert as above.
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @copilotkit/outpost exec vitest run shared/src/__tests__/platforms-inbound.test.ts`

Expected: FAIL — `authorType` is `undefined`.

- [ ] **Step 3: Reorder and write**

In `handleNewTicket`, the `isTeamMember` call currently happens **after** the message is created (line 189). Move it above the `prisma.message.create` block so its result is available, then pass it through:

```typescript
        // Resolved before the message is written: the message row records
        // whether its author is on our team, which nothing downstream can
        // recover from the author display string alone.
        const isTeam = await this.isTeamMember(message.platformUserId, message.source);

        let messageId: string | null = null;
        if (message.content) {
            const msg = await this.prisma.message.create({
                data: {
                    ticketId: ticket.id,
                    author: authorLabel,
                    content: truncate(message.content, 8000),
                    type: 'USER',
                    authorType: isTeam ? 'TEAM' : 'COMMUNITY',
                    userId,
                    attachments: message.attachments ? JSON.parse(JSON.stringify(message.attachments)) : undefined,
                },
            });
            messageId = msg.id;
        }
```

`userId` is already in scope in `handleNewTicket` from the `findOrCreateUser` call that sets `ticket.userId`. In `handleReply` (line 231) the same treatment applies, but that method has no `userId` yet — call `findOrCreateUser` there before creating the message and pass the result.

Delete the now-duplicated `const isTeam = await this.isTeamMember(...)` that followed each create.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @copilotkit/outpost exec vitest run shared/src/__tests__/platforms-inbound.test.ts`

Expected: PASS, including every pre-existing test in that file.

- [ ] **Step 5: Commit**

```bash
git add packages/outpost/shared/src/platforms/inbound.ts packages/outpost/shared/src/__tests__/platforms-inbound.test.ts
git commit -m "feat(shared): persist authorType and userId on inbound messages

isTeamMember was already computed for every reply and discarded."
```

---

### Task 5: Make authorType required

**Files:**
- Modify: `packages/outpost/db/prisma/schema.prisma` (Message.authorType)
- Create: a second migration directory

**Interfaces:**
- Consumes: Tasks 1, 3, 4 — the column exists, every row is populated, and new writes set it.

- [ ] **Step 1: Confirm zero nulls remain**

```bash
docker exec outpost-pg18-prodclone psql -U outpost -d outpost -Atc \
  'select count(*) from "Message" where "authorType" is null;'
```

Expected: `0`. **If it is not 0, stop** and report — making the column required with nulls present will fail the migration.

- [ ] **Step 2: Drop the `?`**

```prisma
    authorType        MessageAuthorType
```

- [ ] **Step 3: Generate and apply**

```bash
DATABASE_URL="postgresql://outpost:outpost@localhost:5433/outpost?schema=public" \
  pnpm --filter @copilotkit/outpost exec prisma migrate dev \
  --schema=db/prisma/schema.prisma --name require_message_author_type
```

Expected: migration applies cleanly.

- [ ] **Step 4: Commit**

```bash
git add packages/outpost/db/prisma/schema.prisma packages/outpost/db/prisma/migrations
git commit -m "feat(db): require Message.authorType now that rows are backfilled"
```

---

### Task 6: needs-human-reply API route

**Files:**
- Create: `apps/web/src/app/api/dashboard/needs-human-reply/route.ts`
- Delete: `apps/web/src/app/api/dashboard/my-tasks/route.ts`
- Test: `apps/web/src/__tests__/needs-human-reply-api.test.ts`
- Modify: `apps/web/src/__tests__/dashboard-api.test.ts` (drop the my-tasks describe block and its import)

**Interfaces:**
- Produces, consumed by Task 7:
  ```typescript
  {
      count: number;
      tickets: Array<{
          id: string;
          displayId: string;
          title: string;
          source: string;
          reporter: string | null;
          createdAt: string;
          lastActivityAt: string;   // newest message on the ticket
          aiRepliedAt: string;      // newest AI message
      }>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/needs-human-reply-api.test.ts`. Mock `@copilotkit/outpost/db` the same way `dashboard-api.test.ts:8-28` does, adding `MessageAuthorType: { TEAM: 'TEAM', COMMUNITY: 'COMMUNITY', AI: 'AI', SYSTEM: 'SYSTEM' }` to the mock. Then:

```typescript
import { GET as needsHumanReplyGet } from '@/app/api/dashboard/needs-human-reply/route';

function req(source?: string): Request {
    const url = source
        ? `http://localhost/api/dashboard/needs-human-reply?source=${source}`
        : 'http://localhost/api/dashboard/needs-human-reply';
    return new Request(url);
}

function ticket(overrides: Record<string, unknown> = {}) {
    return {
        id: 'tkt-1',
        displayId: 'TKT-0001',
        title: 'Something broke',
        source: 'GITHUB_ISSUE',
        createdAt: new Date('2026-07-01T10:00:00Z'),
        user: { name: 'reporter' },
        messages: [
            { authorType: 'AI', createdAt: new Date('2026-07-01T10:05:00Z') },
        ],
        ...overrides,
    };
}

describe('GET /api/dashboard/needs-human-reply', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(userSession('tm-1'));
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetServerSession.mockResolvedValue(null);
        const res = await needsHumanReplyGet(req());
        expect(res.status).toBe(401);
    });

    it('includes a ticket whose AI reply has no follow-up', async () => {
        mockTicketFindMany.mockResolvedValue([ticket()]);
        const res = await needsHumanReplyGet(req());
        const body = await res.json();
        expect(body.count).toBe(1);
        expect(body.tickets[0].displayId).toBe('TKT-0001');
    });

    it('excludes a ticket where a TEAM message came after the AI reply', async () => {
        mockTicketFindMany.mockResolvedValue([
            ticket({
                messages: [
                    { authorType: 'AI', createdAt: new Date('2026-07-01T10:05:00Z') },
                    { authorType: 'TEAM', createdAt: new Date('2026-07-01T11:00:00Z') },
                ],
            }),
        ]);
        const res = await needsHumanReplyGet(req());
        const body = await res.json();
        expect(body.count).toBe(0);
    });

    it('KEEPS a ticket where only the reporter replied after the AI', async () => {
        mockTicketFindMany.mockResolvedValue([
            ticket({
                messages: [
                    { authorType: 'AI', createdAt: new Date('2026-07-01T10:05:00Z') },
                    { authorType: 'COMMUNITY', createdAt: new Date('2026-07-01T12:00:00Z') },
                ],
            }),
        ]);
        const res = await needsHumanReplyGet(req());
        const body = await res.json();
        expect(body.count).toBe(1);
    });

    it('excludes a ticket with a TEAM reply even when the reporter replied after it', async () => {
        mockTicketFindMany.mockResolvedValue([
            ticket({
                messages: [
                    { authorType: 'AI', createdAt: new Date('2026-07-01T10:05:00Z') },
                    { authorType: 'TEAM', createdAt: new Date('2026-07-01T11:00:00Z') },
                    { authorType: 'COMMUNITY', createdAt: new Date('2026-07-01T13:00:00Z') },
                ],
            }),
        ]);
        const res = await needsHumanReplyGet(req());
        const body = await res.json();
        expect(body.count).toBe(0);
    });

    it('excludes a ticket with no AI reply at all', async () => {
        mockTicketFindMany.mockResolvedValue([
            ticket({ messages: [{ authorType: 'COMMUNITY', createdAt: new Date() }] }),
        ]);
        const res = await needsHumanReplyGet(req());
        const body = await res.json();
        expect(body.count).toBe(0);
    });

    it('passes the source filter to the query', async () => {
        mockTicketFindMany.mockResolvedValue([]);
        await needsHumanReplyGet(req('DISCORD'));
        const args = mockTicketFindMany.mock.calls[0][0] as { where: { source?: string } };
        expect(args.where.source).toBe('DISCORD');
    });

    it('orders oldest AI reply first', async () => {
        mockTicketFindMany.mockResolvedValue([
            ticket({ id: 'new', displayId: 'TKT-NEW', messages: [{ authorType: 'AI', createdAt: new Date('2026-07-20T10:00:00Z') }] }),
            ticket({ id: 'old', displayId: 'TKT-OLD', messages: [{ authorType: 'AI', createdAt: new Date('2026-07-01T10:00:00Z') }] }),
        ]);
        const res = await needsHumanReplyGet(req());
        const body = await res.json();
        expect(body.tickets.map((t: { displayId: string }) => t.displayId)).toEqual(['TKT-OLD', 'TKT-NEW']);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @copilotkit/outpost-web exec vitest run src/__tests__/needs-human-reply-api.test.ts`

Expected: FAIL — route module not found.

- [ ] **Step 3: Write the route**

Create `apps/web/src/app/api/dashboard/needs-human-reply/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@copilotkit/outpost/db';
import { TicketStatus } from '@copilotkit/outpost/db';

/**
 * GET /api/dashboard/needs-human-reply?source=DISCORD
 *
 * Tickets where the AI answered and no team member has followed up since.
 *
 * A reply from the reporter deliberately does NOT clear a ticket: an
 * unanswered "that didn't work" needs attention more than a silent thread,
 * not less. Only a TEAM message newer than the newest AI message clears it.
 */
export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const source = new URL(request.url).searchParams.get('source') ?? undefined;

        const tickets = await prisma.ticket.findMany({
            where: {
                status: {
                    notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED],
                },
                ...(source ? { source } : {}),
            },
            select: {
                id: true,
                displayId: true,
                title: true,
                source: true,
                createdAt: true,
                user: { select: { name: true } },
                messages: {
                    select: { authorType: true, createdAt: true },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        const needsReply = [];

        for (const ticket of tickets) {
            const aiMessages = ticket.messages.filter((m) => m.authorType === 'AI');
            if (aiMessages.length === 0) continue;

            const newestAi = aiMessages[aiMessages.length - 1];
            const teamReplied = ticket.messages.some(
                (m) => m.authorType === 'TEAM' && m.createdAt > newestAi.createdAt,
            );
            if (teamReplied) continue;

            const lastMessage = ticket.messages[ticket.messages.length - 1];

            needsReply.push({
                id: ticket.id,
                displayId: ticket.displayId,
                title: ticket.title,
                source: ticket.source,
                reporter: ticket.user?.name ?? null,
                createdAt: ticket.createdAt,
                lastActivityAt: lastMessage.createdAt,
                aiRepliedAt: newestAi.createdAt,
            });
        }

        // Oldest unanswered AI reply first — longest-ignored at the top.
        needsReply.sort(
            (a, b) => a.aiRepliedAt.getTime() - b.aiRepliedAt.getTime(),
        );

        return NextResponse.json({ count: needsReply.length, tickets: needsReply });
    } catch (error) {
        console.error('[GET /api/dashboard/needs-human-reply] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @copilotkit/outpost-web exec vitest run src/__tests__/needs-human-reply-api.test.ts`

Expected: PASS, all eight tests.

- [ ] **Step 5: Delete the my-tasks route and its tests**

```bash
rm -r apps/web/src/app/api/dashboard/my-tasks
```

Remove the `myTasksGet` import (line 63) and the whole `describe('GET /api/dashboard/my-tasks', ...)` block from `apps/web/src/__tests__/dashboard-api.test.ts`.

- [ ] **Step 6: Run the whole web suite**

Run: `pnpm --filter @copilotkit/outpost-web test`

Expected: PASS with no references to the deleted route.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/api/dashboard apps/web/src/__tests__
git commit -m "feat(web): needs-human-reply route, replacing my-tasks

my-tasks keyed off assigneeId; 45 of 51 tickets are unassigned, so it
always read 'All caught up'."
```

---

### Task 7: Panel and card

**Files:**
- Create: `apps/web/src/components/dashboard/needs-human-reply.tsx`
- Delete: `apps/web/src/components/dashboard/my-tasks.tsx`
- Modify: `apps/web/src/components/dashboard/sla-health.tsx:6-57`
- Modify: `apps/web/src/app/dashboard/page.tsx`
- Modify: `apps/web/src/app/api/dashboard/stats/route.ts` (drop `slaBreaches`)
- Test: `apps/web/src/__tests__/needs-human-reply.test.tsx`, and delete any `my-tasks` component test

**Interfaces:**
- Consumes: the route from Task 6.
- Produces: `<NeedsHumanReply />` (self-fetching, same as the old `MyTasks`), and `SlaMetrics` becomes `{ needsHumanReply: number; avgFirstResponseMs: number; avgResolutionMs: number; hasResolutionData: boolean }`.

- [ ] **Step 1: Write the failing component test**

Create `apps/web/src/__tests__/needs-human-reply.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { NeedsHumanReply } from '@/components/dashboard/needs-human-reply';

const payload = {
    count: 2,
    tickets: [
        {
            id: 't1', displayId: 'TKT-OLD', title: 'Threads not persisting',
            source: 'GITHUB_ISSUE', reporter: 'someone',
            createdAt: '2026-07-01T10:00:00Z', lastActivityAt: '2026-07-01T10:05:00Z',
            aiRepliedAt: '2026-07-01T10:05:00Z',
        },
        {
            id: 't2', displayId: 'TKT-NEW', title: 'Python SDK behind',
            source: 'DISCORD', reporter: null,
            createdAt: '2026-07-20T10:00:00Z', lastActivityAt: '2026-07-20T10:05:00Z',
            aiRepliedAt: '2026-07-20T10:05:00Z',
        },
    ],
};

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => payload,
    }));
});

describe('NeedsHumanReply', () => {
    it('lists each ticket with its source', async () => {
        render(<NeedsHumanReply />);
        await waitFor(() => expect(screen.getByText('TKT-OLD')).toBeInTheDocument());
        expect(screen.getByText('TKT-NEW')).toBeInTheDocument();
        expect(screen.getByText('Threads not persisting')).toBeInTheDocument();
    });

    it('shows the caught-up state when nothing needs a reply', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ count: 0, tickets: [] }),
        }));
        render(<NeedsHumanReply />);
        await waitFor(() => expect(screen.getByTestId('needs-human-reply-empty')).toBeInTheDocument());
    });

    it('titles the panel Needs Human Reply', async () => {
        render(<NeedsHumanReply />);
        await waitFor(() => expect(screen.getByText('Needs Human Reply')).toBeInTheDocument());
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @copilotkit/outpost-web exec vitest run src/__tests__/needs-human-reply.test.tsx`

Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/dashboard/needs-human-reply.tsx`, modelled on the existing `my-tasks.tsx` structure (client component, self-fetching, filter dropdown in the header). Two differences from `MyTasks`: the filter lists **sources** (`All`, `DISCORD`, `GITHUB_ISSUE`, `GITHUB_DISCUSSION`) rather than statuses, and each row links to `/tickets?id=<id>`. Empty state gets `data-testid="needs-human-reply-empty"` with the copy "Nothing waiting on a human. Every AI reply has been followed up."

Read `my-tasks.tsx` before writing this and mirror its class names so the panel is visually identical.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @copilotkit/outpost-web exec vitest run src/__tests__/needs-human-reply.test.tsx`

Expected: PASS.

- [ ] **Step 5: Swap the card**

In `apps/web/src/components/dashboard/sla-health.tsx`, replace the `SlaMetrics` interface and the first card:

```tsx
export interface SlaMetrics {
    needsHumanReply: number;
    avgFirstResponseMs: number;
    avgResolutionMs: number;
    /** False when no ticket has ever been resolved — the average is absent, not zero. */
    hasResolutionData: boolean;
}
```

```tsx
        {
            label: 'Needs Human Reply',
            value: metrics ? String(metrics.needsHumanReply) : '—',
            icon: AlertTriangle,
            color: metrics && metrics.needsHumanReply > 0 ? 'text-destructive' : 'text-green-400',
            bgColor: metrics && metrics.needsHumanReply > 0 ? 'bg-destructive/10' : 'bg-green-500/10',
        },
```

and the resolution card, so no-data reads as no-data:

```tsx
        {
            label: 'Avg Resolution Time',
            value: metrics && metrics.hasResolutionData
                ? formatDuration(metrics.avgResolutionMs)
                : '—',
            icon: CheckCircle2,
            color: 'text-purple-400',
            bgColor: 'bg-purple-500/10',
        },
```

Add a test to `apps/web/src/__tests__/` asserting the resolution card renders `—` when `hasResolutionData` is false and a duration when it is true.

- [ ] **Step 6: Update the stats route and the page**

In `apps/web/src/app/api/dashboard/stats/route.ts`, delete the `slaBreaches` count from the `Promise.all` block and from the response object, and add `hasResolutionData: resolvedTickets.length > 0`.

In `apps/web/src/app/dashboard/page.tsx`: import `NeedsHumanReply` instead of `MyTasks`, render it in the same slot, fetch `/api/dashboard/needs-human-reply` for the count, and build `slaMetrics` from `{ needsHumanReply: count, avgFirstResponseMs, avgResolutionMs, hasResolutionData }`.

```bash
rm apps/web/src/components/dashboard/my-tasks.tsx
```

- [ ] **Step 7: Full verification**

Run: `pnpm --filter @copilotkit/outpost-web typecheck && pnpm --filter @copilotkit/outpost-web test && pnpm --filter @copilotkit/outpost test`

Expected: all green, no dangling `MyTasks` or `slaBreaches` references. Confirm with `grep -rn "MyTasks\|slaBreaches" apps/web/src | grep -v node_modules` returning nothing.

- [ ] **Step 8: Verify against the prod-data clone**

With the dev server on 3001 and an authenticated cookie jar:

```bash
curl -s -b /tmp/cookies.txt http://localhost:3001/api/dashboard/needs-human-reply \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["count"]); print([t["displayId"] for t in d["tickets"][:3]])'
```

Expected: `50`, and `TKT-AD8S9CHR` absent from the full list. Check the browser: the panel lists 50 tickets, the third card reads 50, and Avg Resolution Time shows `—`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): Needs Human Reply panel and card

Replaces My Tasks (always empty — keyed off an assignee nobody sets) and
SLA Breaches (flagged all 51 tickets). Avg Resolution now shows a dash
when nothing has ever been resolved, rather than '0 sec'."
```

---

## Notes for the implementer

- `TeamMember.name` is empty for `nathan@copilotkit.ai` in production, so that member renders blank in the assignee dropdown. Out of scope for this PR — flag it in your report, don't fix it here.
- Do not touch `packages/outpost/shared/src/sla/` or the `SLA_CHECK` job. The SLA engine keeps running and keeps stamping `slaBreachedAt`; this PR only stops the dashboard from showing that number. Per-account contractual SLAs come later.
