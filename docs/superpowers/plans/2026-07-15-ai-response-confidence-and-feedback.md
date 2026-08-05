# AI Response Confidence Display + Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use copilotkit-internal:micro-task-execution to implement this plan task-by-task (team policy deprecates superpowers:subagent-driven-development for this repo). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI's confidence score reflect the actual generated response (not a placeholder), surface it per-ticket in the dashboard, and give GitHub a real feedback mechanism matching Discord's existing buttons — with negative feedback on either channel routing through the existing escalation path.

**Architecture:** Confidence scoring moves from parallel-with-generation to sequential (score the real text). Three new nullable fields on `Message` (`confidenceScore`, `confidenceLevel`, `feedback`) plus one for GitHub comment tracking (`externalCommentId`). The `PlatformAdapter.postResponse` interface widens to return the platform message/comment ID (needed to poll GitHub reactions against the right comment later) — four of five adapters just return `undefined`, only `GitHubAdapter` returns a real ID. GitHub feedback is polling-based (confirmed: GitHub has no reactions webhook), a new `GITHUB_REACTION_POLL` job on the existing `Scheduler`/24h cadence, reusing the existing `ESCALATION` job for negative feedback — same as Discord already does.

**Tech Stack:** Prisma migration, TypeScript across `packages/outpost/{ai,shared,queue,db}` and `apps/{web,discord-bot,worker}`, Vitest (mocked Prisma per repo convention), React/Next.js for the dashboard badge.

## Global Constraints

- No aggregate confidence/gaps dashboard view — explicitly deferred, out of scope for this plan.
- No `AlertManager` rework — it's dead code today and this feature doesn't need it.
- Posting behavior is unchanged — always posts, disclaimer + escalate below the existing `AI_CONFIDENCE.ESCALATE` (0.4) threshold. Confidence becomes a real signal, not a gate.
- GitHub feedback only counts a reaction from the ticket's original reporter (matches Discord, where only the thread starter sees the feedback buttons).
- GitHub reaction poll runs every 24 hours (confirmed interval — GitHub has no webhook event for reactions, verified against GitHub's official webhook docs directly).
- Every task ends with passing tests using this repo's existing mocked-Prisma Vitest convention. No task is done without a red-then-green test cycle — hard rule in this repo, no exceptions.
- Do not modify `apps/github-app/src/lib/github-client.ts` — it already works; the new shared GitHub client module for the worker process is a separate, parallel implementation, not a refactor of the existing one (avoids regression risk on already-working code).

---

## Task 1: Schema migration — confidence + feedback + comment-ID fields

**Files:**
- Modify: `packages/outpost/db/prisma/schema.prisma`

**Interfaces:**
- Produces: `Message.confidenceScore Float?`, `Message.confidenceLevel String?`, `Message.feedback String?`, `Message.externalCommentId String?` — consumed by Tasks 2-9.

- [ ] **Step 1: Add the fields**

Modify the `Message` model in `packages/outpost/db/prisma/schema.prisma` (currently lines 99-111):

```prisma
model Message {
    id                String      @id @default(cuid())
    ticketId          String
    ticket            Ticket      @relation(fields: [ticketId], references: [id], onDelete: Cascade)
    author            String
    content           String
    type              MessageType @default(USER)
    isAiGenerated     Boolean     @default(false)
    confidenceScore    Float?
    confidenceLevel    String?     // "HIGH" | "MEDIUM" | "LOW"
    feedback           String?     // "POSITIVE" | "NEGATIVE" | null (no feedback yet)
    externalCommentId  String?     // GitHub comment/discussion-comment ID this message was posted as, if applicable
    attachments        Json?
    createdAt          DateTime    @default(now())

    @@index([ticketId])
    @@index([isAiGenerated, feedback])
}
```

(Only the 4 new fields and the new index are additions — every other line is unchanged from the current model.)

- [ ] **Step 2: Generate and apply the migration**

Run: `cd packages/outpost/db && npx prisma migrate dev --schema=prisma/schema.prisma --name add_message_confidence_and_feedback`
Expected: migration file created under `packages/outpost/db/prisma/migrations/`, applies cleanly to the local dev database.

- [ ] **Step 3: Regenerate the Prisma client**

Run: `cd packages/outpost && pnpm run db:generate`
Expected: exits 0, `@prisma/client` types now include the 4 new fields.

- [ ] **Step 4: Commit**

```bash
git add packages/outpost/db/prisma/schema.prisma packages/outpost/db/prisma/migrations/
git commit -m "feat(db): add confidence, feedback, and externalCommentId fields to Message"
```

---

## Task 2: Sequential confidence scoring — score the real response

**Files:**
- Modify: `packages/outpost/ai/src/pipeline.ts`
- Create: `packages/outpost/ai/src/__tests__/pipeline.test.ts` (check first if this file already exists — if so, add to it instead of creating; read it in full before editing either way)

**Interfaces:**
- Consumes: `ConfidenceScorer.score(question, response, searchResults)` — signature unchanged, only the call site's `response` argument changes from `''` to the real generated text.
- Produces: `AIPipeline.generateSupportResponse` behavior change — confidence scoring now runs after generation, not in parallel. `PipelineResult` shape is unchanged.

- [ ] **Step 1: Write the failing test**

Check whether `packages/outpost/ai/src/__tests__/pipeline.test.ts` already exists (`find packages/outpost/ai/src -iname "pipeline.test.ts"`). If it exists, read it in full first to match its existing mocking style before adding this test. If it doesn't exist, create it with this minimal structure (adjust the mock style to match how other tests in `packages/outpost/ai/src/__tests__/` mock `PathfinderClient`/`ResponseGenerator`/`ConfidenceScorer` — read at least one sibling test file first, e.g. `confidence.test.ts` or `generator.test.ts`, to match constructor-injection conventions used elsewhere in this package):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AIPipeline } from '../pipeline.js';
import { ConfidenceLevel } from '../types.js';

describe('AIPipeline.generateSupportResponse — sequential confidence scoring', () => {
    it('scores confidence against the actual generated response text, not a placeholder', async () => {
        const mockSearchDocs = vi.fn().mockResolvedValue([
            { title: 'Doc', content: 'content', score: 0.8, url: 'https://example.com' },
        ]);
        const mockGenerate = vi.fn().mockResolvedValue({
            text: 'The real generated answer text',
            confidenceScore: 0.9,
            tokenUsage: { inputTokens: 10, outputTokens: 20 },
        });
        const mockScore = vi.fn().mockResolvedValue({
            level: ConfidenceLevel.HIGH,
            score: 0.85,
            reasoning: 'Good match',
            tokenUsage: { inputTokens: 5, outputTokens: 5 },
            degraded: false,
        });

        const pipeline = new AIPipeline({
            pathfinder: { searchDocs: mockSearchDocs, disconnect: vi.fn() } as never,
            generator: { generate: mockGenerate } as never,
            confidenceScorer: { score: mockScore, heuristicScore: vi.fn() } as never,
            classifier: { classify: vi.fn(), heuristicClassify: vi.fn() } as never,
            formatter: { format: vi.fn().mockReturnValue({ text: 'formatted', platform: 'web' }) } as never,
        });

        await pipeline.generateSupportResponse('a question', { source: 'web' });

        expect(mockScore).toHaveBeenCalledWith(
            'a question',
            'The real generated answer text',
            expect.any(Array),
        );
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/outpost/ai && pnpm test -- pipeline.test.ts --reporter=dot`
Expected: FAIL — `mockScore` was called with `''` (the placeholder), not the generated text, because generation and scoring still run in parallel.

- [ ] **Step 3: Make scoring sequential**

Replace lines 69-92 of `packages/outpost/ai/src/pipeline.ts` (the `Promise.all` block) with:

```typescript
        // Step 2: Generate response
        const pipelineContext: PipelineContext = {
            question,
        };

        const generatedResponse = await this.generator.generate(
            pipelineContext,
            searchResults,
            options.conversationHistory,
        );

        // Step 3: Score confidence against the ACTUAL generated response
        // (sequential, not parallel — the scorer needs the real text to
        // produce a meaningful signal, not a retrieval-quality proxy).
        const confidenceAssessment = await this.confidenceScorer
            .score(question, generatedResponse.text, searchResults)
            .catch((error) => {
                console.error(`[Pipeline] Confidence scoring failed: ${error instanceof Error ? error.message : String(error)}`);
                return this.confidenceScorer.heuristicScore(searchResults);
            });
```

Everything from the current line 94 onward (`// Aggregate token usage`) stays exactly as-is — `generatedResponse` and `confidenceAssessment` are still the same two variable names, just no longer destructured from a `Promise.all` array.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/outpost/ai && pnpm test -- pipeline.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Run the full package test suite**

Run: `cd packages/outpost/ai && pnpm test --reporter=dot`
Expected: all pre-existing tests still pass (no other test should have depended on the parallel timing or the `''` placeholder).

- [ ] **Step 6: Commit**

```bash
git add packages/outpost/ai/src/pipeline.ts packages/outpost/ai/src/__tests__/pipeline.test.ts
git commit -m "fix(ai): score confidence against the real generated response, not a placeholder"
```

---

## Task 3: Widen `PlatformAdapter.postResponse` to return the posted message ID

**Files:**
- Modify: `packages/outpost/shared/src/platforms/types.ts`
- Modify: `packages/outpost/shared/src/platforms/github.ts`
- Modify: `packages/outpost/shared/src/platforms/discord.ts`
- Modify: `packages/outpost/shared/src/platforms/slack.ts`
- Modify: `packages/outpost/shared/src/platforms/teams.ts`
- Modify: `packages/outpost/shared/src/platforms/email-postmark.ts`
- Modify their corresponding test files (read each first — e.g. `packages/outpost/shared/src/platforms/__tests__/github.test.ts` or wherever they live; `find packages/outpost/shared/src/platforms -iname "*.test.ts"`)

**Interfaces:**
- Produces: `PlatformAdapter.postResponse(...): Promise<string | undefined>` — Task 4 consumes the return value for GitHub only.

**Why this task exists:** adapters are cached singletons (`getAdapter()` in `registry.ts` caches one instance per `TicketSource`, reused across concurrent job executions). Storing "the last posted comment ID" as adapter instance state would race under the worker's `AI_RESPONSE` concurrency (up to 4 concurrent jobs). The return value is the only race-free way to get the ID back to the caller.

- [ ] **Step 1: Write the failing test**

Read `packages/outpost/shared/src/platforms/__tests__/github.test.ts` (or wherever GitHub adapter tests live — locate with `find packages/outpost/shared/src/platforms -iname "*github*test*"`) in full first to match its existing mock style for `GitHubOctokitLike`. Add a test:

```typescript
it('postResponse returns the created comment ID', async () => {
    const mockOctokit = {
        issues: {
            createComment: vi.fn().mockResolvedValue({ data: { id: 999888 } }),
        },
        graphql: vi.fn(),
    };
    const adapter = new GitHubAdapter({ octokit: mockOctokit });

    const result = await adapter.postResponse(
        { id: 't1', sourceId: 'owner/repo#42', channel: null, source: TicketSource.GITHUB_ISSUE },
        { text: 'response text', platform: 'github' } as never,
    );

    expect(result).toBe('999888');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/outpost/shared && pnpm test -- github.test.ts --reporter=dot`
Expected: FAIL — `postResponse` currently returns `undefined` (implicit `Promise<void>`).

- [ ] **Step 3: Widen the interface**

In `packages/outpost/shared/src/platforms/types.ts`, change the `postResponse` signature (currently returns `Promise<void>`) to:

```typescript
    /**
     * Post a formatted AI response back to the platform thread/issue/conversation.
     * The ticket carries sourceId and channel info needed to route the message.
     *
     * Returns the platform-specific ID of the posted message/comment when
     * available (used to poll for feedback later), or undefined when the
     * platform doesn't expose one / the adapter doesn't track it.
     */
    postResponse(
        ticket: { id: string; sourceId: string | null; channel: string | null; source: TicketSource },
        response: FormattedResponse,
    ): Promise<string | undefined>;
```

- [ ] **Step 4: Make `GitHubAdapter` return the real comment ID**

In `packages/outpost/shared/src/platforms/github.ts`:

Change `GitHubOctokitLike.issues.createComment`'s already-correct return type is fine (`Promise<{ data: { id: number } }>`) — no change needed there.

Change `postResponse` (currently lines 241-255) to return the ID:

```typescript
    async postResponse(
        ticket: { id: string; sourceId: string | null; channel: string | null; source: TicketSource },
        response: FormattedResponse,
    ): Promise<string | undefined> {
        if (!ticket.sourceId) {
            throw new Error(
                `Cannot post GitHub response — ticket ${ticket.id} has no sourceId`,
            );
        }

        let body = response.text;
        body += '\n\n---\nWas this helpful? React with 👍 or 👎';

        return this.postComment(ticket, body);
    }
```

Change `postComment` (currently lines 279-288, returns `Promise<void>`) to propagate the ID:

```typescript
    private async postComment(
        ticket: { id: string; sourceId: string | null; channel: string | null; source: TicketSource },
        body: string,
    ): Promise<string | undefined> {
        if (ticket.source === TicketSource.GITHUB_DISCUSSION) {
            return this.postDiscussionComment(ticket, body);
        }
        return this.postIssueComment(ticket, body);
    }
```

Change `postIssueComment` (currently lines 293-309, returns `Promise<void>`) to return the ID:

```typescript
    private async postIssueComment(
        ticket: { id: string; sourceId: string | null; channel: string | null; source: TicketSource },
        body: string,
    ): Promise<string | undefined> {
        const parsed = parseSourceId(ticket.sourceId!);
        if (!parsed) {
            throw new Error(`Invalid GitHub sourceId: ${ticket.sourceId}`);
        }

        const octokit = this.getOctokit();
        const result = await octokit.issues.createComment({
            owner: parsed.owner,
            repo: parsed.repo,
            issue_number: parsed.number,
            body,
        });
        return String(result.data.id);
    }
```

Change `postDiscussionComment` (currently lines 317-366, returns `Promise<void>`) to return the comment node ID at the end:

```typescript
    private async postDiscussionComment(
        ticket: { id: string; sourceId: string | null; channel: string | null; source: TicketSource },
        body: string,
    ): Promise<string | undefined> {
        const octokit = this.getOctokit();

        let nodeId = (ticket as Record<string, unknown>).discussionNodeId as string | undefined;

        if (!nodeId) {
            const parsed = parseSourceId(ticket.sourceId!);
            if (!parsed) {
                throw new Error(`Invalid GitHub sourceId: ${ticket.sourceId}`);
            }

            const result = await octokit.graphql<{
                repository: { discussion: { id: string } };
            }>(
                `query GetDiscussionId($owner: String!, $repo: String!, $number: Int!) {
                    repository(owner: $owner, name: $repo) {
                        discussion(number: $number) {
                            id
                        }
                    }
                }`,
                {
                    owner: parsed.owner,
                    repo: parsed.repo,
                    number: parsed.number,
                },
            );

            nodeId = result.repository.discussion.id;
        }

        const result = await octokit.graphql<{
            addDiscussionComment: { comment: { id: string } };
        }>(
            `mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
                addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
                    comment {
                        id
                    }
                }
            }`,
            {
                discussionId: nodeId,
                body,
            },
        );

        return result.addDiscussionComment.comment.id;
    }
```

(Note: the GraphQL mutation's `graphql<T>` call needs its generic type to include the `comment.id` field, which it already requests in the mutation string — only the TS generic annotation on the second `octokit.graphql` call and the `return` line are new; the mutation string itself is unchanged.)

Also update `postSystemMessage` (currently lines 261-272) — it currently calls `postComment` and returns `Promise<void>`; since `postComment` now returns `Promise<string | undefined>`, `postSystemMessage`'s own return type must stay `Promise<void>` per the unchanged interface — so it must NOT return `postComment`'s result. Change it to:

```typescript
    async postSystemMessage(
        ticket: { id: string; sourceId: string | null; channel: string | null; source: TicketSource },
        message: string,
    ): Promise<void> {
        if (!ticket.sourceId) {
            throw new Error(
                `Cannot post GitHub system message — ticket ${ticket.id} has no sourceId`,
            );
        }

        await this.postComment(ticket, message);
    }
```

(Only change: `await this.postComment(...)` instead of `return this.postComment(...)` — since `postComment`'s type changed, the old `return` form would leak the new return type into `postSystemMessage`'s `Promise<void>` signature and fail typecheck.)

- [ ] **Step 5: Update the other 4 adapters to return `undefined`**

Read each of `discord.ts`, `slack.ts`, `teams.ts`, `email-postmark.ts` in full first (find their `postResponse` methods). Each currently returns `Promise<void>` with no explicit return statement (or `return;`). Change each method's signature to `Promise<string | undefined>` and add an explicit `return undefined;` at the end (replacing any bare `return;`), OR if the method's last statement is a call that itself now returns something incompatible, add `return undefined;` after it rather than returning that call's result — these four adapters do NOT need to track message IDs for this feature; the goal is purely type-signature parity with the widened interface. Do not add any new logic to these four files beyond the signature and final return statement.

- [ ] **Step 6: Run tests to verify everything passes**

Run: `cd packages/outpost/shared && pnpm test --reporter=dot`
Expected: all tests pass, including the new GitHub one and any existing tests for the other 4 adapters (which should be unaffected since their behavior didn't change, only their declared return type).

- [ ] **Step 7: Run typecheck**

Run: `cd packages/outpost/shared && pnpm typecheck` (or `npx tsc --project shared/tsconfig.json --noEmit` from `packages/outpost`)
Expected: clean. This is the step that actually proves all 5 adapters correctly implement the widened interface.

- [ ] **Step 8: Call-Site Enumeration**

Run `grep -rn "\.postResponse(" packages/outpost apps --include="*.ts" | grep -v test`. There should be exactly one production call site: `packages/outpost/queue/src/handlers/ai-response.ts` (Task 4 updates it to consume the new return value). Confirm no other call site exists that assumed `void`.

- [ ] **Step 9: Commit**

```bash
git add packages/outpost/shared/src/platforms/
git commit -m "feat(shared): widen PlatformAdapter.postResponse to return the posted message ID"
```

---

## Task 4: Persist confidence + externalCommentId on the AI Message row

**Files:**
- Modify: `packages/outpost/queue/src/handlers/ai-response.ts`
- Modify: `packages/outpost/queue/src/__tests__/ai-response.test.ts` (find the exact path with `find packages/outpost/queue/src -iname "*ai-response*test*"`; read it in full first to match its mocking style)

**Interfaces:**
- Consumes: `PipelineResult.confidenceScore`/`confidenceLevel` (Task 2, unchanged shape); `adapter.postResponse(...)`'s new return value (Task 3).
- Produces: `Message.confidenceScore`/`confidenceLevel`/`externalCommentId` are now populated at creation/post time — consumed by Task 5 (UI) and Task 9 (reaction poll query).

- [ ] **Step 1: Write the failing tests**

Read the existing `ai-response.test.ts` in full first. Add these two tests (adapt mock variable names to match the file's existing convention):

```typescript
it('persists confidenceScore and confidenceLevel on the created Message', async () => {
    // ...existing setup mocking ticket/pipeline as this file already does, with
    // pipelineResult.confidenceScore = 0.75, confidenceLevel = 'HIGH'...
    await handleAiResponse({ ticketId: 'ticket-1' }, mockContext);

    expect(mockMessageCreate).toHaveBeenCalledWith(
        expect.objectContaining({
            data: expect.objectContaining({
                confidenceScore: 0.75,
                confidenceLevel: 'HIGH',
            }),
        }),
    );
});

it('persists externalCommentId when the adapter returns one', async () => {
    // ...existing setup, with hasAdapter/getAdapter mocked to return an
    // adapter whose postResponse resolves to '999888'...
    mockAdapterPostResponse.mockResolvedValue('999888');

    await handleAiResponse({ ticketId: 'ticket-1' }, mockContext);

    expect(mockMessageUpdate).toHaveBeenCalledWith({
        where: { id: expect.any(String) },
        data: { externalCommentId: '999888' },
    });
});
```

(These are illustrative — match the exact existing mock setup pattern in the file, which likely already mocks `prisma.ticket.findUnique`, `AIPipeline`, `hasAdapter`/`getAdapter`, etc. Add `mockMessageUpdate` as a new mock if `prisma.message.update` isn't already mocked in this file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/outpost/queue && pnpm test -- ai-response.test.ts --reporter=dot`
Expected: FAIL — neither field is persisted today.

- [ ] **Step 3: Persist confidence at message creation**

In `packages/outpost/queue/src/handlers/ai-response.ts`, change the `prisma.message.create` call (currently lines 142-150) to:

```typescript
        // 5. Persist the AI-generated response as a Message record
        const aiMessage = await prisma.message.create({
            data: {
                ticketId: ticket.id,
                content: pipelineResult.response,
                type: 'BOT',
                author: 'Outpost AI',
                isAiGenerated: true,
                confidenceScore: pipelineResult.confidenceScore,
                confidenceLevel: pipelineResult.confidenceLevel,
            },
        });
```

(Only change: assign the result to `aiMessage` instead of discarding it, and add the two new fields. `aiMessage.id` is needed in Step 4 below.)

- [ ] **Step 4: Persist externalCommentId after posting**

Change the `adapter.postResponse(...)` call (currently lines 200-210, inside the `if (adapter)` block) to capture and persist the returned ID:

```typescript
            if (adapter) {
                try {
                    const externalCommentId = await adapter.postResponse(
                        {
                            id: ticket.id,
                            sourceId: ticket.sourceId,
                            channel: ticket.channel,
                            source: ticketSource,
                        },
                        pipelineResult.formatted,
                    );
                    if (externalCommentId) {
                        await prisma.message.update({
                            where: { id: aiMessage.id },
                            data: { externalCommentId },
                        });
                    }
                    console.log(
                        `[AI Response] Posted response to ${ticket.source} for ticket ${ticketId}`,
                    );
                } catch (error) {
                    console.error(
                        `[AI Response] Failed to post response to ${ticket.source} for ticket ${ticketId}:`,
                        error instanceof Error ? error.message : String(error),
                    );
                }
            }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/outpost/queue && pnpm test -- ai-response.test.ts --reporter=dot`
Expected: PASS, plus all pre-existing tests in the file still pass.

- [ ] **Step 6: Run the full package test suite**

Run: `cd packages/outpost/queue && pnpm test --reporter=dot`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/outpost/queue/src/handlers/ai-response.ts packages/outpost/queue/src/__tests__/ai-response.test.ts
git commit -m "feat(queue): persist confidence score/level and GitHub comment ID on AI messages"
```

---

## Task 5: Confidence badge on the ticket conversation thread

**Files:**
- Modify: `apps/web/src/components/tickets/types.ts`
- Modify: `apps/web/src/components/tickets/conversation-thread.tsx`
- Create: `apps/web/src/components/tickets/__tests__/conversation-thread.test.tsx` (check first if a test file for this component already exists via `find apps/web/src/components/tickets -iname "*conversation-thread*test*"`; if so, add to it)

**Interfaces:**
- Consumes: `ConfidenceBadge` + `ConfidenceLevel` type from `apps/web/src/components/qa/confidence-badge.tsx` (existing, unchanged).
- Consumes: `Message.confidenceLevel` (Task 1's schema field) — flows through automatically since `apps/web/src/app/api/tickets/[id]/route.ts`'s `GET` handler returns the raw Prisma `ticket` object with no field-stripping (verified — no change needed to that route file).

- [ ] **Step 1: Add the field to `TicketMessage`**

In `apps/web/src/components/tickets/types.ts`, change the `TicketMessage` interface (currently lines 12-21) to:

```typescript
export interface TicketMessage {
    id: string;
    ticketId: string;
    author: string;
    content: string;
    type: MessageType;
    isAiGenerated: boolean;
    confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | null;
    attachments: Array<{ name: string; url: string; size: string }> | null;
    createdAt: string;
}
```

(Only addition: `confidenceLevel`.)

- [ ] **Step 2: Write the failing test**

Create (or add to) `apps/web/src/components/tickets/__tests__/conversation-thread.test.tsx`. If creating fresh, check a sibling test file first (e.g. anything under `apps/web/src/components/tickets/__tests__/` or `apps/web/src/components/qa/__tests__/confidence-badge.test.tsx`) to match the repo's React Testing Library setup/render helpers:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationThread } from '../conversation-thread';
import { MessageType } from '@copilotkit/outpost/shared';

function makeMessage(overrides: Partial<Parameters<typeof ConversationThread>[0]['messages'][0]> = {}) {
    return {
        id: 'm1',
        ticketId: 't1',
        author: 'Outpost AI',
        content: 'An answer',
        type: MessageType.BOT,
        isAiGenerated: true,
        confidenceLevel: null,
        attachments: null,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

describe('ConversationThread confidence badge', () => {
    it('renders the confidence badge for an AI message with a confidence level', () => {
        render(<ConversationThread messages={[makeMessage({ confidenceLevel: 'HIGH' })]} />);
        const badge = screen.getByTestId('confidence-badge');
        expect(badge).toHaveAttribute('data-level', 'HIGH');
    });

    it('does not render a confidence badge for a message with no confidence level', () => {
        render(<ConversationThread messages={[makeMessage({ confidenceLevel: null })]} />);
        expect(screen.queryByTestId('confidence-badge')).not.toBeInTheDocument();
    });

    it('does not render a confidence badge for a non-AI message', () => {
        render(<ConversationThread messages={[makeMessage({ isAiGenerated: false, type: MessageType.USER, confidenceLevel: null })]} />);
        expect(screen.queryByTestId('confidence-badge')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && pnpm test -- conversation-thread.test.tsx --reporter=dot`
Expected: FAIL — no badge rendered anywhere yet.

- [ ] **Step 4: Add the badge**

In `apps/web/src/components/tickets/conversation-thread.tsx`:

Add the import at the top (alongside the existing imports):

```typescript
import { ConfidenceBadge } from '@/components/qa/confidence-badge';
```

In the `UserMessage` component (currently lines 151-193), inside the header row (currently lines 168-180), add the badge right after the existing `isBot && (...AI generated...)` pill (currently lines 172-176) and before the timestamp span:

```tsx
                        {isBot && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium">
                                AI generated
                            </span>
                        )}
                        {message.isAiGenerated && message.confidenceLevel && (
                            <ConfidenceBadge level={message.confidenceLevel} />
                        )}
                        <span className="text-[10px] text-muted-foreground">
                            {formatTimestamp(message.createdAt)}
                        </span>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && pnpm test -- conversation-thread.test.tsx --reporter=dot`
Expected: PASS.

- [ ] **Step 6: Run typecheck and the full web test suite**

Run: `cd apps/web && pnpm typecheck && pnpm test --reporter=dot`
Expected: both clean/green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/tickets/types.ts apps/web/src/components/tickets/conversation-thread.tsx apps/web/src/components/tickets/__tests__/conversation-thread.test.tsx
git commit -m "feat(web): show confidence badge on AI-generated ticket messages"
```

---

## Task 6: Discord buttons write feedback to the Message row

**Files:**
- Modify: `apps/discord-bot/src/interactions/buttons.ts`
- Modify: `apps/discord-bot/src/interactions/__tests__/buttons.test.ts` (find with `find apps/discord-bot/src -iname "*buttons*test*"`; read in full first)

**Interfaces:**
- Produces: `Message.feedback` set to `'POSITIVE'`/`'NEGATIVE'` — consumed nowhere else in this plan (it's the terminal write for Discord; GitHub's equivalent write happens in Task 9), but establishes the value convention (`'POSITIVE'`/`'NEGATIVE'` strings) that Task 9 must match exactly.

- [ ] **Step 1: Write the failing tests**

Read the existing `buttons.test.ts` in full first to match its exact mocking style for `prisma`, `createJob`, `findTicketByThreadId`, and the `ButtonInteraction` mock shape. Add two tests:

```typescript
it('handleIssueSolved writes POSITIVE feedback to the latest AI message', async () => {
    // ...existing setup for a valid thread + ticket...
    mockMessageFindFirst.mockResolvedValue({ id: 'msg-ai-1' });

    await handleButtonInteraction(makeInteraction('issue_solved'));

    expect(mockMessageFindFirst).toHaveBeenCalledWith({
        where: { ticketId: 'ticket-1', isAiGenerated: true, feedback: null },
        orderBy: { createdAt: 'desc' },
    });
    expect(mockMessageUpdate).toHaveBeenCalledWith({
        where: { id: 'msg-ai-1' },
        data: { feedback: 'POSITIVE' },
    });
});

it('handleNeedMoreHelp writes NEGATIVE feedback to the latest AI message', async () => {
    // ...existing setup...
    mockMessageFindFirst.mockResolvedValue({ id: 'msg-ai-1' });

    await handleButtonInteraction(makeInteraction('need_more_help'));

    expect(mockMessageUpdate).toHaveBeenCalledWith({
        where: { id: 'msg-ai-1' },
        data: { feedback: 'NEGATIVE' },
    });
});

it('does not throw when no un-fed-back AI message exists', async () => {
    // ...existing setup...
    mockMessageFindFirst.mockResolvedValue(null);

    await expect(handleButtonInteraction(makeInteraction('issue_solved'))).resolves.not.toThrow();
    expect(mockMessageUpdate).not.toHaveBeenCalled();
});
```

(`makeInteraction` and the exact mock function names — `mockMessageFindFirst`, `mockMessageUpdate` — should match whatever helper/mock names the existing test file already uses; if the file doesn't yet mock `prisma.message.findFirst`/`update`, add them to its existing `vi.mock('@copilotkit/outpost/db', ...)` block.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/discord-bot && pnpm test -- buttons.test.ts --reporter=dot`
Expected: FAIL — neither handler queries or updates a `Message` today.

- [ ] **Step 3: Implement the feedback write**

In `apps/discord-bot/src/interactions/buttons.ts`, add a shared helper above `handleIssueSolved`:

```typescript
async function recordFeedback(ticketId: string, feedback: 'POSITIVE' | 'NEGATIVE'): Promise<void> {
    const latestAiMessage = await prisma.message.findFirst({
        where: { ticketId, isAiGenerated: true, feedback: null },
        orderBy: { createdAt: 'desc' },
    });

    if (latestAiMessage) {
        await prisma.message.update({
            where: { id: latestAiMessage.id },
            data: { feedback },
        });
    }
}
```

In `handleIssueSolved`, add a call to `recordFeedback` right after the existing `prisma.ticket.update` call (currently lines 46-49), before the SYSTEM message creation:

```typescript
    // Update ticket status to CLOSED
    await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'CLOSED' },
    });

    await recordFeedback(ticket.id, 'POSITIVE');

    // Log the resolution as a system message
```

In `handleNeedMoreHelp`, add the equivalent call right after the existing `prisma.ticket.update` call (currently lines 89-92), before the `createJob(JobType.ESCALATION, ...)` call:

```typescript
    // Update ticket to waiting on team
    await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'WAITING_ON_TEAM' },
    });

    await recordFeedback(ticket.id, 'NEGATIVE');

    // Enqueue an escalation notification
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/discord-bot && pnpm test -- buttons.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Run the full discord-bot test suite**

Run: `cd apps/discord-bot && pnpm test --reporter=dot`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/discord-bot/src/interactions/buttons.ts apps/discord-bot/src/interactions/__tests__/buttons.test.ts
git commit -m "feat(discord-bot): record thumbs up/down feedback on AI messages via existing buttons"
```

---

## Task 7: Shared GitHub client for the worker process (reactions read access)

**Files:**
- Create: `packages/outpost/shared/src/integrations/github-client.ts`
- Create: `packages/outpost/shared/src/integrations/__tests__/github-client.test.ts`
- Modify: `packages/outpost/shared/src/integrations/index.ts` (export the new module — read it first to confirm the barrel pattern used for sibling integrations like `hubspot.ts`/`linear.ts`)
- Modify: `packages/outpost/package.json` (add `@octokit/rest` and `@octokit/auth-app` as dependencies)

**Interfaces:**
- Produces: `createGithubClient(config: { appId: string; privateKey: string; installationId: string }): GithubReactionClient` and `listCommentReactions(client, owner, repo, commentId): Promise<Array<{ content: string; login: string }>>` — consumed by Task 9.

**Why a new module instead of reusing `apps/github-app/src/lib/github-client.ts`:** that file lives inside `apps/github-app`, a separate process/package from `apps/worker` (confirmed — `apps/worker`'s dependencies are only `@copilotkit/outpost`, no Octokit anywhere). This plan deliberately does not touch the already-working `apps/github-app` code; this is new, parallel plumbing scoped to what the worker needs (read-only reactions access), not a refactor.

- [ ] **Step 1: Add the dependencies**

In `packages/outpost/package.json`, add to the `dependencies` block (alongside the existing `@anthropic-ai/sdk`, `@linear/sdk`, etc.):

```json
        "@octokit/auth-app": "^7.0.0",
        "@octokit/rest": "^21.0.0",
```

Run: `pnpm install` from the repo root.
Expected: lockfile updates cleanly, no errors.

- [ ] **Step 2: Write the failing test**

Create `packages/outpost/shared/src/integrations/__tests__/github-client.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { listCommentReactions } from '../github-client.js';

describe('listCommentReactions', () => {
    it('returns each reaction with its content and reactor login', async () => {
        const mockClient = {
            reactions: {
                listForIssueComment: vi.fn().mockResolvedValue({
                    data: [
                        { content: '+1', user: { login: 'reporter-user' } },
                        { content: '-1', user: { login: 'someone-else' } },
                    ],
                }),
            },
        };

        const result = await listCommentReactions(mockClient as never, 'owner', 'repo', 12345);

        expect(result).toEqual([
            { content: '+1', login: 'reporter-user' },
            { content: '-1', login: 'someone-else' },
        ]);
        expect(mockClient.reactions.listForIssueComment).toHaveBeenCalledWith({
            owner: 'owner',
            repo: 'repo',
            comment_id: 12345,
        });
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/outpost/shared && pnpm test -- github-client.test.ts --reporter=dot`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 4: Implement the module**

Create `packages/outpost/shared/src/integrations/github-client.ts`:

```typescript
/**
 * Minimal GitHub App client for the worker process — read-only access
 * to comment reactions, used by the GITHUB_REACTION_POLL job.
 *
 * Deliberately separate from apps/github-app/src/lib/github-client.ts,
 * which lives in a different process and handles posting. This module
 * only needs reaction reads, and the worker process has no other
 * Octokit access today.
 */

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

export interface GithubClientConfig {
    appId: string;
    privateKey: string;
    installationId: string;
}

/** Minimal interface for the one Octokit call this module needs. */
export interface GithubReactionClient {
    reactions: {
        listForIssueComment(params: {
            owner: string;
            repo: string;
            comment_id: number;
        }): Promise<{ data: Array<{ content: string; user: { login: string } | null }> }>;
    };
}

export function createGithubClient(config: GithubClientConfig): GithubReactionClient {
    return new Octokit({
        authStrategy: createAppAuth,
        auth: {
            appId: config.appId,
            privateKey: config.privateKey,
            installationId: config.installationId,
        },
    }) as unknown as GithubReactionClient;
}

export interface CommentReaction {
    content: string;
    login: string;
}

/**
 * List reactions on a GitHub issue comment (also works for discussion
 * comments posted via REST-style comment IDs — GitHub reactions share
 * the same endpoint shape for both).
 */
export async function listCommentReactions(
    client: GithubReactionClient,
    owner: string,
    repo: string,
    commentId: number,
): Promise<CommentReaction[]> {
    const response = await client.reactions.listForIssueComment({
        owner,
        repo,
        comment_id: commentId,
    });

    return response.data
        .filter((r) => r.user !== null)
        .map((r) => ({ content: r.content, login: r.user!.login }));
}
```

- [ ] **Step 5: Export from the integrations barrel**

Read `packages/outpost/shared/src/integrations/index.ts` in full first to match its existing export style. Add:

```typescript
export { createGithubClient, listCommentReactions } from './github-client.js';
export type { GithubClientConfig, GithubReactionClient, CommentReaction } from './github-client.js';
```

- [ ] **Step 6: Confirm the barrel re-export reaches the package's public surface**

Check `packages/outpost/shared/src/index.ts` already does `export * from './integrations/index.js'` (or equivalent) — if it does, the new exports are automatically public via `@copilotkit/outpost/shared`, no further action. If it does NOT already re-export integrations at that level, add the equivalent export line there (match the existing pattern for how `hubspot`/`linear` integrations are exposed).

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/outpost/shared && pnpm test -- github-client.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 8: Run typecheck**

Run: `cd packages/outpost/shared && pnpm typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/outpost/package.json pnpm-lock.yaml packages/outpost/shared/src/integrations/github-client.ts packages/outpost/shared/src/integrations/__tests__/github-client.test.ts packages/outpost/shared/src/integrations/index.ts packages/outpost/shared/src/index.ts
git commit -m "feat(shared): add read-only GitHub reactions client for the worker process"
```

(Adjust the `git add` file list if Step 6 didn't require touching `shared/src/index.ts`.)

---

## Task 8: New `GITHUB_REACTION_POLL` job type

**Files:**
- Modify: `packages/outpost/queue/src/types.ts`

**Interfaces:**
- Produces: `JobType.GITHUB_REACTION_POLL`, `GithubReactionPollPayload` (empty, no fields needed — mirrors `SlaCheckPayload`/`JobCleanupPayload`) — consumed by Tasks 9 and 10.

- [ ] **Step 1: Write the failing test**

This is a pure type addition with no runtime behavior — check first whether `packages/outpost/queue/src/__tests__/types.test.ts` exists (`find packages/outpost/queue/src -iname "*types*test*"`). If no such file exists, this task has nothing to red/green test in isolation — its correctness is proven by Task 9's handler test (which imports `JobType.GITHUB_REACTION_POLL`) failing to compile until this task lands. Skip Step 1-2's red-green cycle for this task specifically and proceed directly to Step 3 (the change itself); Task 9's tests provide the real coverage. Note this explicitly in the commit message.

- [ ] **Step 2: Add the job type and payload**

In `packages/outpost/queue/src/types.ts`, add to the `JobType` enum (currently lines 12-31), after `JOB_CLEANUP`:

```typescript
    /** Poll GitHub reactions on AI-authored comments for feedback signal */
    GITHUB_REACTION_POLL = 'GITHUB_REACTION_POLL',
```

Add a new payload interface, after `JobCleanupPayload` (currently lines 80-82):

```typescript
export interface GithubReactionPollPayload {
    // No payload needed — runs against all pending-feedback AI messages
}
```

Add the mapping entry to `JobPayload` (currently lines 85-95), after `[JobType.JOB_CLEANUP]`:

```typescript
    [JobType.GITHUB_REACTION_POLL]: GithubReactionPollPayload;
```

- [ ] **Step 3: Run the package typecheck**

Run: `cd packages/outpost/queue && pnpm typecheck`
Expected: clean (this is a pure additive type change; nothing else references it yet).

- [ ] **Step 4: Commit**

```bash
git add packages/outpost/queue/src/types.ts
git commit -m "feat(queue): add GITHUB_REACTION_POLL job type (no test — pure type addition, covered by Task 9's handler test)"
```

---

## Task 9: `GITHUB_REACTION_POLL` handler

**Files:**
- Create: `packages/outpost/queue/src/handlers/github-reaction-poll.ts`
- Create: `packages/outpost/queue/src/handlers/__tests__/github-reaction-poll.test.ts`
- Modify: `packages/outpost/queue/src/index.ts` (export the new handler)

**Interfaces:**
- Consumes: `createGithubClient`/`listCommentReactions` (Task 7), `JobType.GITHUB_REACTION_POLL`/`GithubReactionPollPayload` (Task 8), `Message.externalCommentId`/`feedback` (Task 1/4), `Ticket.user.externalId` (existing schema — the reporter's GitHub login).
- Produces: `handleGithubReactionPoll: JobHandler<typeof JobType.GITHUB_REACTION_POLL>` — consumed by Task 10 (worker registration).

- [ ] **Step 1: Write the failing tests**

Read `packages/outpost/queue/src/handlers/sla-check.ts`'s test file first (`find packages/outpost/queue/src/handlers/__tests__ -iname "*sla-check*"`) to match this package's handler-test mocking conventions exactly (how `prisma`, `JobHandlerContext`, and env vars are mocked). Create `packages/outpost/queue/src/handlers/__tests__/github-reaction-poll.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMessageFindMany = vi.fn();
const mockMessageUpdate = vi.fn();
const mockCreateJob = vi.fn();
const mockListCommentReactions = vi.fn();
const mockCreateGithubClient = vi.fn().mockReturnValue({});

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        message: {
            findMany: (...args: unknown[]) => mockMessageFindMany(...args),
            update: (...args: unknown[]) => mockMessageUpdate(...args),
        },
    },
}));

vi.mock('@copilotkit/outpost/shared', () => ({
    createGithubClient: (...args: unknown[]) => mockCreateGithubClient(...args),
    listCommentReactions: (...args: unknown[]) => mockListCommentReactions(...args),
}));

vi.mock('../../create-job.js', () => ({
    createJob: (...args: unknown[]) => mockCreateJob(...args),
}));

import { handleGithubReactionPoll } from '../github-reaction-poll.js';
import { JobType } from '../../types.js';

const context = { reportProgress: vi.fn().mockResolvedValue(undefined), jobId: 'job-1' };

describe('handleGithubReactionPoll', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GITHUB_APP_ID = 'app-1';
        process.env.GITHUB_PRIVATE_KEY = 'key';
        process.env.GITHUB_INSTALLATION_ID = '123';
    });

    it('sets POSITIVE feedback when the reporter reacted +1', async () => {
        mockMessageFindMany.mockResolvedValue([
            {
                id: 'msg-1',
                externalCommentId: '999',
                ticket: { sourceId: 'owner/repo#42', user: { externalId: 'reporter-login' } },
            },
        ]);
        mockListCommentReactions.mockResolvedValue([
            { content: '+1', login: 'reporter-login' },
        ]);

        const result = await handleGithubReactionPoll({}, context);

        expect(mockMessageUpdate).toHaveBeenCalledWith({
            where: { id: 'msg-1' },
            data: { feedback: 'POSITIVE' },
        });
        expect(mockCreateJob).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
    });

    it('sets NEGATIVE feedback and enqueues ESCALATION when the reporter reacted -1', async () => {
        mockMessageFindMany.mockResolvedValue([
            {
                id: 'msg-1',
                ticketId: 'ticket-1',
                externalCommentId: '999',
                ticket: { sourceId: 'owner/repo#42', user: { externalId: 'reporter-login' } },
            },
        ]);
        mockListCommentReactions.mockResolvedValue([
            { content: '-1', login: 'reporter-login' },
        ]);

        await handleGithubReactionPoll({}, context);

        expect(mockMessageUpdate).toHaveBeenCalledWith({
            where: { id: 'msg-1' },
            data: { feedback: 'NEGATIVE' },
        });
        expect(mockCreateJob).toHaveBeenCalledWith(JobType.ESCALATION, {
            ticketId: 'ticket-1',
            reason: expect.stringContaining('GitHub reaction'),
        });
    });

    it('ignores a reaction from someone other than the reporter', async () => {
        mockMessageFindMany.mockResolvedValue([
            {
                id: 'msg-1',
                externalCommentId: '999',
                ticket: { sourceId: 'owner/repo#42', user: { externalId: 'reporter-login' } },
            },
        ]);
        mockListCommentReactions.mockResolvedValue([
            { content: '+1', login: 'someone-else' },
        ]);

        await handleGithubReactionPoll({}, context);

        expect(mockMessageUpdate).not.toHaveBeenCalled();
    });

    it('skips a message with no externalCommentId', async () => {
        mockMessageFindMany.mockResolvedValue([
            { id: 'msg-1', externalCommentId: null, ticket: { sourceId: 'owner/repo#42', user: { externalId: 'reporter-login' } } },
        ]);

        await handleGithubReactionPoll({}, context);

        expect(mockListCommentReactions).not.toHaveBeenCalled();
        expect(mockMessageUpdate).not.toHaveBeenCalled();
    });

    it('queries only unresolved AI-generated GitHub messages', async () => {
        mockMessageFindMany.mockResolvedValue([]);

        await handleGithubReactionPoll({}, context);

        expect(mockMessageFindMany).toHaveBeenCalledWith({
            where: {
                isAiGenerated: true,
                feedback: null,
                externalCommentId: { not: null },
                ticket: {
                    source: { in: ['GITHUB_ISSUE', 'GITHUB_DISCUSSION'] },
                },
            },
            include: {
                ticket: {
                    select: {
                        id: true,
                        sourceId: true,
                        user: { select: { externalId: true } },
                    },
                },
            },
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/outpost/queue && pnpm test -- github-reaction-poll.test.ts --reporter=dot`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the handler**

Create `packages/outpost/queue/src/handlers/github-reaction-poll.ts`:

```typescript
/**
 * GITHUB_REACTION_POLL job handler.
 *
 * GitHub has no webhook event for reactions (confirmed against GitHub's
 * official webhook docs) — this is the only way to detect a 👍/👎 on the
 * AI's own comment. Runs every 24 hours (see scheduler.ts). For each
 * AI-generated GitHub message with no feedback yet, checks whether the
 * ticket's original reporter reacted +1 or -1 on that specific comment.
 * A -1 also enqueues an ESCALATION job, matching Discord's
 * "Need more help" button behavior.
 */

import { prisma } from '@copilotkit/outpost/db';
import { createGithubClient, listCommentReactions } from '@copilotkit/outpost/shared';
import { createJob } from '../create-job.js';
import { JobType } from '../types.js';
import type { GithubReactionPollPayload, JobResult, JobHandlerContext } from '../types.js';

/**
 * Parse "owner/repo#number" into its components.
 */
function parseSourceId(sourceId: string): { owner: string; repo: string } | null {
    const match = sourceId.match(/^(.+?)\/(.+?)#\d+$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
}

export async function handleGithubReactionPoll(
    _payload: GithubReactionPollPayload,
    context: JobHandlerContext,
): Promise<JobResult> {
    await context.reportProgress(10);

    const pendingMessages = await prisma.message.findMany({
        where: {
            isAiGenerated: true,
            feedback: null,
            externalCommentId: { not: null },
            ticket: {
                source: { in: ['GITHUB_ISSUE', 'GITHUB_DISCUSSION'] },
            },
        },
        include: {
            ticket: {
                select: {
                    id: true,
                    sourceId: true,
                    user: { select: { externalId: true } },
                },
            },
        },
    });

    await context.reportProgress(20);

    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_PRIVATE_KEY;
    const installationId = process.env.GITHUB_INSTALLATION_ID;

    if (!appId || !privateKey || !installationId) {
        return {
            success: false,
            error: 'GITHUB_APP_ID/GITHUB_PRIVATE_KEY/GITHUB_INSTALLATION_ID not configured',
        };
    }

    const client = createGithubClient({ appId, privateKey, installationId });

    let checked = 0;
    let updated = 0;

    for (const message of pendingMessages) {
        checked += 1;

        if (!message.externalCommentId || !message.ticket.sourceId || !message.ticket.user?.externalId) {
            continue;
        }

        const parsed = parseSourceId(message.ticket.sourceId);
        if (!parsed) continue;

        const reporterLogin = message.ticket.user.externalId;
        const commentId = Number(message.externalCommentId);

        let reactions;
        try {
            reactions = await listCommentReactions(client, parsed.owner, parsed.repo, commentId);
        } catch (error) {
            console.error(
                `[GithubReactionPoll] Failed to list reactions for message ${message.id}:`,
                error instanceof Error ? error.message : String(error),
            );
            continue;
        }

        const reporterReaction = reactions.find((r) => r.login === reporterLogin);
        if (!reporterReaction) continue;

        if (reporterReaction.content === '+1') {
            await prisma.message.update({
                where: { id: message.id },
                data: { feedback: 'POSITIVE' },
            });
            updated += 1;
        } else if (reporterReaction.content === '-1') {
            await prisma.message.update({
                where: { id: message.id },
                data: { feedback: 'NEGATIVE' },
            });
            await createJob(JobType.ESCALATION, {
                ticketId: message.ticket.id,
                reason: 'User reacted 👎 (negative) via GitHub reaction — automated escalation',
            });
            updated += 1;
        }
    }

    await context.reportProgress(100);

    console.log(`[GithubReactionPoll] Checked ${checked} messages, updated ${updated} with feedback`);

    return {
        success: true,
        data: { checked, updated },
    };
}
```

- [ ] **Step 4: Export the handler**

In `packages/outpost/queue/src/index.ts`, add after the existing `export { handleJobCleanup } from './handlers/job-cleanup.js';` line:

```typescript
export { handleGithubReactionPoll } from './handlers/github-reaction-poll.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/outpost/queue && pnpm test -- github-reaction-poll.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 6: Run the full package test suite and typecheck**

Run: `cd packages/outpost/queue && pnpm test --reporter=dot && pnpm typecheck`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add packages/outpost/queue/src/handlers/github-reaction-poll.ts packages/outpost/queue/src/handlers/__tests__/github-reaction-poll.test.ts packages/outpost/queue/src/index.ts
git commit -m "feat(queue): add GITHUB_REACTION_POLL handler — real GitHub feedback via reaction polling"
```

---

## Task 10: Wire the periodic job into the Scheduler and register the handler in the worker

**Files:**
- Modify: `packages/outpost/queue/src/scheduler.ts`
- Modify: `packages/outpost/queue/src/__tests__/scheduler.test.ts` (find with `find packages/outpost/queue/src -iname "*scheduler*test*"`; read in full first)
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: `handleGithubReactionPoll` (Task 9), `JobType.GITHUB_REACTION_POLL` (Task 8).
- Produces: nothing consumed by later tasks — this is the last task, the one that makes everything else actually run.

- [ ] **Step 1: Write the failing test**

Read the existing `scheduler.test.ts` in full first. Add:

```typescript
it('includes GITHUB_REACTION_POLL in the default scheduled jobs at a 24 hour interval', () => {
    const definition = DEFAULT_SCHEDULED_JOBS.find((d) => d.type === JobType.GITHUB_REACTION_POLL);
    expect(definition).toBeDefined();
    expect(definition!.intervalMs).toBe(24 * 60 * 60 * 1000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/outpost/queue && pnpm test -- scheduler.test.ts --reporter=dot`
Expected: FAIL — no such entry exists yet.

- [ ] **Step 3: Add the scheduled job**

In `packages/outpost/queue/src/scheduler.ts`, add to `DEFAULT_SCHEDULED_JOBS` (currently lines 12-43), after the `JOB_CLEANUP` entry:

```typescript
    {
        type: JobType.GITHUB_REACTION_POLL,
        payload: {},
        intervalMs: 24 * 60 * 60 * 1000, // 24 hours
        description: 'Poll GitHub reactions on AI-authored comments for feedback signal',
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/outpost/queue && pnpm test -- scheduler.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Register the handler in the worker**

In `apps/worker/src/index.ts`, add `handleGithubReactionPoll` to the import from `@copilotkit/outpost/queue` (currently lines 21-34):

```typescript
import {
    Worker,
    Scheduler,
    JobType,
    handleAiResponse,
    handleEscalation,
    handleSlaCheck,
    handleOnboardingDigest,
    handleAccountScoring,
    handleHubSpotSync,
    createTrackerSyncHandler,
    handleJobCleanup,
    handleGithubReactionPoll,
    createJob,
} from '@copilotkit/outpost/queue';
```

Add a `concurrencyByType` entry (currently lines 48-57) — low concurrency is fine, this job type has no payload variance and runs rarely:

```typescript
    concurrencyByType: {
        [JobType.AI_RESPONSE]: 4,
        [JobType.ESCALATION]: 2,
        [JobType.SLA_CHECK]: 1,
        [JobType.ONBOARDING_DIGEST]: 1,
        [JobType.ACCOUNT_SCORING]: 1,
        [JobType.HUBSPOT_SYNC]: 1,
        [JobType.TRACKER_SYNC]: 1,
        [JobType.JOB_CLEANUP]: 1,
        [JobType.GITHUB_REACTION_POLL]: 1,
    },
```

Register the handler (currently lines 67-74), after `worker.on(JobType.JOB_CLEANUP, handleJobCleanup);`:

```typescript
worker.on(JobType.GITHUB_REACTION_POLL, handleGithubReactionPoll);
```

Update the file's top-of-file doc comment (currently lines 8-16, the "Job types and their handlers" list) to add a line after `JOB_CLEANUP`:

```
 *   - GITHUB_REACTION_POLL: Poll GitHub reactions on AI comments (no webhook exists)
```

- [ ] **Step 6: Run typecheck and build**

Run: `cd apps/worker && pnpm typecheck && pnpm build`
Expected: both clean — this is the step that would have caught Task 7's dependency wiring if it were wrong (the worker now transitively depends on `@octokit/rest`/`@octokit/auth-app` through `@copilotkit/outpost/shared`).

- [ ] **Step 7: Run the worker's test suite**

Run: `cd apps/worker && pnpm test --reporter=dot`
Expected: green (this app's existing test — from the prior sync-mapping-persistence work — plus nothing new needed here, since the actual handler logic is tested in Task 9).

- [ ] **Step 8: Commit**

```bash
git add packages/outpost/queue/src/scheduler.ts packages/outpost/queue/src/__tests__/scheduler.test.ts apps/worker/src/index.ts
git commit -m "feat(worker): schedule GITHUB_REACTION_POLL every 24 hours and register its handler"
```

---

## Final Verification

- [ ] **Run the full test suite for every touched package**

```bash
cd apps/web && pnpm test && pnpm typecheck
cd ../discord-bot && pnpm test && pnpm typecheck
cd ../worker && pnpm test && pnpm typecheck
cd ../../packages/outpost && pnpm test && pnpm typecheck
```

Expected: all green, no regressions in any of the four packages/apps.

- [ ] **Build check**

```bash
cd apps/web && pnpm build
cd ../discord-bot && pnpm build
cd ../worker && pnpm build
cd ../../packages/outpost && pnpm run build
```

Expected: all exit 0.

- [ ] **Manual verification note for the human reviewer**

The GitHub reaction poll cannot be end-to-end tested without a live GitHub App installation and a real comment to react to. Automated tests cover the handler's logic (reporter-only filtering, +1/-1 mapping, escalation trigger) against a mocked Octokit client. Before considering this fully verified in production, manually trigger one `GITHUB_REACTION_POLL` job against a real test issue with a real 👍/👎 from the reporter account, and confirm `Message.feedback` updates as expected.
