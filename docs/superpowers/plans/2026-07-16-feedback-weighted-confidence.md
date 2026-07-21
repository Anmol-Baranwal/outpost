# Feedback-Weighted Confidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the aggregate 👍/👎 feedback signal calibrate the confidence score of future AI responses.

**Architecture:** A pure, DB-free calibration function in the `ai` package maps an aggregate feedback tally to a bounded adjustment. A reader in the `queue` package counts feedback rows and calls it. The pipeline applies the adjustment (passed in as an option) to the final confidence score before classification. The `ai-response` handler wires the reader to the pipeline, fail-soft.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Prisma, Vitest.

## Global Constraints

- `ai` package stays DB-free — the calibration function receives a tally, never touches Prisma.
- Default/omitted `confidenceCalibration` = current behavior exactly (regression guard).
- Calibration bounded to `[-0.15, +0.15]`; returns `0` below 20 feedback events.
- Final confidence score always clamped to `[0, 1]`.
- No DB migration (reuses `Message.feedback` + `@@index([isAiGenerated, feedback])`).
- Import specifiers use `.js` extension (ESM). Tests via `vitest run --reporter=dot`.
- Single fail-soft site: the reader propagates DB errors; the handler catches and falls back to `0`.

---

### Task 1: Pure calibration function (`ai` package)

**Files:**
- Create: `packages/outpost/ai/src/feedback-calibration.ts`
- Test: `packages/outpost/ai/src/feedback-calibration.test.ts`
- Modify: `packages/outpost/ai/src/index.ts` (add exports)

**Interfaces:**
- Produces: `computeCalibrationFactor(tally: { positives: number; negatives: number }): number`; `interface FeedbackTally { positives: number; negatives: number }`; consts `FEEDBACK_MIN_SAMPLE = 20`, `FEEDBACK_MAX_ADJUSTMENT = 0.15`, `FEEDBACK_SENSITIVITY = 0.6`.

- [ ] **Step 1: Write the failing test**

Create `packages/outpost/ai/src/feedback-calibration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    computeCalibrationFactor,
    FEEDBACK_MAX_ADJUSTMENT,
    FEEDBACK_MIN_SAMPLE,
} from './feedback-calibration.js';

describe('computeCalibrationFactor', () => {
    it('returns 0 below the min-sample threshold', () => {
        expect(computeCalibrationFactor({ positives: 10, negatives: 5 })).toBe(0);
        expect(computeCalibrationFactor({ positives: 0, negatives: 0 })).toBe(0);
    });

    it('returns ~0 for a balanced tally at/above threshold', () => {
        const f = computeCalibrationFactor({ positives: 25, negatives: 25 });
        expect(Math.abs(f)).toBeLessThan(0.02);
    });

    it('saturates positive for an all-positive large tally', () => {
        expect(computeCalibrationFactor({ positives: 500, negatives: 0 })).toBeCloseTo(
            FEEDBACK_MAX_ADJUSTMENT,
            5,
        );
    });

    it('saturates negative for an all-negative large tally', () => {
        expect(computeCalibrationFactor({ positives: 0, negatives: 500 })).toBeCloseTo(
            -FEEDBACK_MAX_ADJUSTMENT,
            5,
        );
    });

    it('is monotonic in positives and always within bounds', () => {
        const a = computeCalibrationFactor({ positives: 30, negatives: 20 });
        const b = computeCalibrationFactor({ positives: 40, negatives: 10 });
        expect(b).toBeGreaterThan(a);
        for (const f of [a, b]) {
            expect(f).toBeGreaterThanOrEqual(-FEEDBACK_MAX_ADJUSTMENT);
            expect(f).toBeLessThanOrEqual(FEEDBACK_MAX_ADJUSTMENT);
        }
    });

    it('does not calibrate on a tally one short of the threshold', () => {
        expect(computeCalibrationFactor({ positives: FEEDBACK_MIN_SAMPLE - 1, negatives: 0 })).toBe(0);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/outpost/ai && npx vitest run src/feedback-calibration.test.ts --reporter=dot`
Expected: FAIL — cannot resolve `./feedback-calibration.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/outpost/ai/src/feedback-calibration.ts`:

```ts
/**
 * Global feedback → confidence calibration.
 *
 * Maps an aggregate 👍/👎 tally to a bounded adjustment applied to FUTURE
 * response confidence scores. Pure and DB-free — the caller supplies the tally
 * (see getFeedbackCalibration in the queue package).
 */

/** Minimum feedback events before calibration engages (avoid calibrating on noise). */
export const FEEDBACK_MIN_SAMPLE = 20;
/** Maximum absolute adjustment applied to a confidence score. */
export const FEEDBACK_MAX_ADJUSTMENT = 0.15;
/** Scales the (ratio - 0.5) signal; tuned so the extremes saturate at the cap. */
export const FEEDBACK_SENSITIVITY = 0.6;

export interface FeedbackTally {
    positives: number;
    negatives: number;
}

/**
 * Compute a bounded confidence adjustment from an aggregate feedback tally.
 * Returns 0 until FEEDBACK_MIN_SAMPLE events exist. Result is always within
 * [-FEEDBACK_MAX_ADJUSTMENT, +FEEDBACK_MAX_ADJUSTMENT].
 */
export function computeCalibrationFactor(tally: FeedbackTally): number {
    const positives = Math.max(0, tally.positives);
    const negatives = Math.max(0, tally.negatives);
    const total = positives + negatives;

    if (total < FEEDBACK_MIN_SAMPLE) {
        return 0;
    }

    // Laplace-smoothed positive ratio keeps small tallies from swinging hard.
    const ratio = (positives + 1) / (total + 2);
    const raw = (ratio - 0.5) * FEEDBACK_SENSITIVITY;

    return Math.max(-FEEDBACK_MAX_ADJUSTMENT, Math.min(FEEDBACK_MAX_ADJUSTMENT, raw));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/outpost/ai && npx vitest run src/feedback-calibration.test.ts --reporter=dot`
Expected: PASS (6 tests).

- [ ] **Step 5: Export from the package entry point**

Modify `packages/outpost/ai/src/index.ts` — add after the `config` export line:

```ts
export {
    computeCalibrationFactor,
    FEEDBACK_MIN_SAMPLE,
    FEEDBACK_MAX_ADJUSTMENT,
    FEEDBACK_SENSITIVITY,
} from './feedback-calibration.js';
export type { FeedbackTally } from './feedback-calibration.js';
```

- [ ] **Step 6: Typecheck + commit**

Run: `cd packages/outpost/ai && npx tsc --noEmit`
Expected: no errors.

```bash
git add packages/outpost/ai/src/feedback-calibration.ts packages/outpost/ai/src/feedback-calibration.test.ts packages/outpost/ai/src/index.ts
git commit -m "feat(ai): pure feedback→confidence calibration function"
```

---

### Task 2: Apply calibration in the pipeline

**Files:**
- Modify: `packages/outpost/ai/src/types.ts` (add field to `PipelineOptions`, ~line 165-174)
- Modify: `packages/outpost/ai/src/pipeline.ts` (`generateSupportResponse`, the `finalConfidenceScore` combine ~line 104-109)
- Test: `packages/outpost/ai/src/pipeline.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `PipelineOptions` (existing), `AIPipeline.generateSupportResponse(question, options)`.
- Produces: `PipelineOptions.confidenceCalibration?: number` (default `0`).

- [ ] **Step 1: Write the failing test**

Append to `packages/outpost/ai/src/pipeline.test.ts` (inside the top-level describe, or a new one). This uses constructor injection of fakes — the `AIPipeline` constructor already accepts `pathfinder`, `generator`, `confidenceScorer`, `classifier`, `formatter`:

```ts
import { AIPipeline } from './pipeline.js';
import { ConfidenceLevel } from './types.js';

function buildPipelineWithScores(generatorScore: number, scorerScore: number) {
    const fakePathfinder = { searchDocs: async () => [] } as unknown as ConstructorParameters<
        typeof AIPipeline
    >[0]['pathfinder'];
    const fakeGenerator = {
        generate: async () => ({
            text: 'answer',
            confidenceScore: generatorScore,
            confidenceLevel: ConfidenceLevel.MEDIUM,
            sources: [],
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
            autoSend: false,
        }),
    } as unknown as ConstructorParameters<typeof AIPipeline>[0]['generator'];
    const fakeScorer = {
        score: async () => ({
            level: ConfidenceLevel.MEDIUM,
            score: scorerScore,
            reasoning: 'test',
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
            degraded: false,
        }),
        heuristicScore: () => ({
            level: ConfidenceLevel.LOW,
            score: 0.2,
            reasoning: 'test',
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
            degraded: false,
        }),
    } as unknown as ConstructorParameters<typeof AIPipeline>[0]['confidenceScorer'];
    const fakeFormatter = {
        format: (text: string) => ({ text, truncated: false }),
    } as unknown as ConstructorParameters<typeof AIPipeline>[0]['formatter'];

    return new AIPipeline({
        pathfinder: fakePathfinder,
        generator: fakeGenerator,
        confidenceScorer: fakeScorer,
        formatter: fakeFormatter,
    });
}

describe('confidence calibration', () => {
    it('leaves the score unchanged when calibration is omitted (regression guard)', async () => {
        const pipeline = buildPipelineWithScores(0.6, 0.6);
        const result = await pipeline.generateSupportResponse('q', { source: 'discord' });
        expect(result.confidenceScore).toBeCloseTo(0.6, 5);
    });

    it('adds a positive calibration factor to the combined score', async () => {
        const pipeline = buildPipelineWithScores(0.6, 0.6);
        const result = await pipeline.generateSupportResponse('q', {
            source: 'discord',
            confidenceCalibration: 0.15,
        });
        expect(result.confidenceScore).toBeCloseTo(0.75, 5);
    });

    it('clamps the calibrated score to at most 1', async () => {
        const pipeline = buildPipelineWithScores(0.95, 0.95);
        const result = await pipeline.generateSupportResponse('q', {
            source: 'discord',
            confidenceCalibration: 0.15,
        });
        expect(result.confidenceScore).toBe(1);
    });

    it('clamps the calibrated score to at least 0', async () => {
        const pipeline = buildPipelineWithScores(0.05, 0.05);
        const result = await pipeline.generateSupportResponse('q', {
            source: 'discord',
            confidenceCalibration: -0.15,
        });
        expect(result.confidenceScore).toBe(0);
    });
});
```

Note: if `pipeline.test.ts` does not already import `describe/it/expect`, add `import { describe, it, expect } from 'vitest';` at the top (skip if present). Verify the fake `generate`/`score` return shapes against `types.ts` (`GeneratedResponse`, `ConfidenceAssessment`) and adjust field names if the local types differ — the shapes above mirror `confidence.ts` and `generator.ts` as of this plan.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/outpost/ai && npx vitest run src/pipeline.test.ts -t "confidence calibration" --reporter=dot`
Expected: FAIL — `confidenceCalibration` not applied (positive-factor and default tests diverge), and/or TS error that `confidenceCalibration` is not on `PipelineOptions`.

- [ ] **Step 3a: Add the option field**

Modify `packages/outpost/ai/src/types.ts` inside `interface PipelineOptions` (after `maxTokens?`):

```ts
    /** Bounded confidence adjustment from aggregate 👍/👎 feedback (default 0). */
    confidenceCalibration?: number;
```

- [ ] **Step 3b: Apply it in the combine step**

Modify `packages/outpost/ai/src/pipeline.ts`. Replace:

```ts
        // Use the more conservative confidence (lower of generator's and scorer's)
        const finalConfidenceScore = Math.min(
            generatedResponse.confidenceScore,
            confidenceAssessment.score,
        );
        const finalConfidence = classifyConfidence(finalConfidenceScore);
```

with:

```ts
        // Use the more conservative confidence (lower of generator's and scorer's),
        // then apply the aggregate-feedback calibration (default 0 = no change).
        const combinedConfidenceScore = Math.min(
            generatedResponse.confidenceScore,
            confidenceAssessment.score,
        );
        const calibration = options.confidenceCalibration ?? 0;
        const finalConfidenceScore = Math.max(
            0,
            Math.min(1, combinedConfidenceScore + calibration),
        );
        const finalConfidence = classifyConfidence(finalConfidenceScore);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/outpost/ai && npx vitest run src/pipeline.test.ts --reporter=dot`
Expected: PASS (existing pipeline tests + 4 new calibration tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/outpost/ai && npx tsc --noEmit`
Expected: no errors.

```bash
git add packages/outpost/ai/src/types.ts packages/outpost/ai/src/pipeline.ts packages/outpost/ai/src/pipeline.test.ts
git commit -m "feat(ai): apply feedback calibration to final confidence score"
```

---

### Task 3: Calibration reader (`queue` package)

**Files:**
- Create: `packages/outpost/queue/src/feedback-calibration.ts`
- Test: `packages/outpost/queue/src/__tests__/feedback-calibration.test.ts`
- Modify: `packages/outpost/queue/src/index.ts` (add export)

**Interfaces:**
- Consumes: `computeCalibrationFactor` from `@copilotkit/outpost/ai`.
- Produces: `getFeedbackCalibration(prisma: FeedbackCountClient): Promise<number>` where `FeedbackCountClient` is a structural type exposing `message.count`.

- [ ] **Step 1: Write the failing test**

Create `packages/outpost/queue/src/__tests__/feedback-calibration.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { getFeedbackCalibration } from '../feedback-calibration.js';

function mockPrisma(counts: { POSITIVE: number; NEGATIVE: number }) {
    return {
        message: {
            count: vi.fn(async ({ where }: { where: { feedback: string } }) =>
                where.feedback === 'POSITIVE' ? counts.POSITIVE : counts.NEGATIVE,
            ),
        },
    };
}

describe('getFeedbackCalibration', () => {
    it('counts POSITIVE and NEGATIVE AI-message feedback with the right filters', async () => {
        const prisma = mockPrisma({ POSITIVE: 300, NEGATIVE: 300 });
        await getFeedbackCalibration(prisma);

        expect(prisma.message.count).toHaveBeenCalledWith({
            where: { isAiGenerated: true, feedback: 'POSITIVE' },
        });
        expect(prisma.message.count).toHaveBeenCalledWith({
            where: { isAiGenerated: true, feedback: 'NEGATIVE' },
        });
    });

    it('returns a positive factor when positives dominate (above threshold)', async () => {
        const prisma = mockPrisma({ POSITIVE: 500, NEGATIVE: 0 });
        expect(await getFeedbackCalibration(prisma)).toBeCloseTo(0.15, 5);
    });

    it('returns 0 below the min-sample threshold', async () => {
        const prisma = mockPrisma({ POSITIVE: 5, NEGATIVE: 3 });
        expect(await getFeedbackCalibration(prisma)).toBe(0);
    });

    it('propagates DB errors (does not swallow)', async () => {
        const prisma = {
            message: { count: vi.fn(async () => { throw new Error('db down'); }) },
        };
        await expect(getFeedbackCalibration(prisma)).rejects.toThrow('db down');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/outpost/queue && npx vitest run src/__tests__/feedback-calibration.test.ts --reporter=dot`
Expected: FAIL — cannot resolve `../feedback-calibration.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/outpost/queue/src/feedback-calibration.ts`:

```ts
import { computeCalibrationFactor } from '@copilotkit/outpost/ai';

/**
 * Minimal structural view of the Prisma client this reader needs. Keeps the
 * reader decoupled from the full PrismaClient type and trivially mockable.
 */
export interface FeedbackCountClient {
    message: {
        count(args: { where: Record<string, unknown> }): Promise<number>;
    };
}

/**
 * Read the aggregate 👍/👎 tally from persisted AI messages and map it to a
 * bounded confidence calibration factor. DB errors propagate — the caller
 * (ai-response handler) owns the single fail-soft fallback.
 */
export async function getFeedbackCalibration(prisma: FeedbackCountClient): Promise<number> {
    const [positives, negatives] = await Promise.all([
        prisma.message.count({ where: { isAiGenerated: true, feedback: 'POSITIVE' } }),
        prisma.message.count({ where: { isAiGenerated: true, feedback: 'NEGATIVE' } }),
    ]);
    return computeCalibrationFactor({ positives, negatives });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/outpost/queue && npx vitest run src/__tests__/feedback-calibration.test.ts --reporter=dot`
Expected: PASS (4 tests).

- [ ] **Step 5: Export + typecheck + commit**

Modify `packages/outpost/queue/src/index.ts` — add before `export * from './types.js';`:

```ts
export { getFeedbackCalibration } from './feedback-calibration.js';
export type { FeedbackCountClient } from './feedback-calibration.js';
```

Run: `cd packages/outpost/queue && npx tsc --noEmit`
Expected: no errors.

```bash
git add packages/outpost/queue/src/feedback-calibration.ts packages/outpost/queue/src/__tests__/feedback-calibration.test.ts packages/outpost/queue/src/index.ts
git commit -m "feat(queue): getFeedbackCalibration reader over Message.feedback"
```

---

### Task 4: Wire the reader into the AI-response handler

**Files:**
- Modify: `packages/outpost/queue/src/handlers/ai-response.ts` (import; read before pipeline call ~line 102-108; pass option; log)
- Test: `packages/outpost/queue/src/__tests__/ai-response.test.ts` (add wiring tests + mock the reader module)

**Interfaces:**
- Consumes: `getFeedbackCalibration` from `../feedback-calibration.js`; `AIPipeline.generateSupportResponse(question, options)` with `confidenceCalibration`.

- [ ] **Step 1: Write the failing test**

In `packages/outpost/queue/src/__tests__/ai-response.test.ts`, add a module mock near the other `vi.mock` calls at the top:

```ts
const mockGetFeedbackCalibration = vi.fn();
vi.mock('../feedback-calibration.js', () => ({
    getFeedbackCalibration: mockGetFeedbackCalibration,
}));
```

Then add tests (a fresh describe block; reuse the file's existing ticket/message mock setup and `beforeEach` — mirror an existing passing test in this file for the ticket/context fixtures):

```ts
describe('confidence calibration wiring', () => {
    it('reads the calibration factor and passes it into the pipeline', async () => {
        mockGetFeedbackCalibration.mockResolvedValue(0.1);
        // ...arrange the same ticket + context fixture an existing happy-path test uses...
        await handleAiResponse(/* payload */ payload, /* context */ context);

        expect(mockGetFeedbackCalibration).toHaveBeenCalled();
        expect(mockGenerateSupportResponse).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ confidenceCalibration: 0.1 }),
        );
    });

    it('falls back to 0 calibration when the reader throws (response still generated)', async () => {
        mockGetFeedbackCalibration.mockRejectedValue(new Error('db down'));
        // ...same happy-path fixture...
        await handleAiResponse(payload, context);

        expect(mockGenerateSupportResponse).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ confidenceCalibration: 0 }),
        );
    });
});
```

Implementer note: copy the exact `payload` + `context` + prisma-return fixtures from the nearest existing happy-path test in this file (the one asserting `generateSupportResponse` is called) so these two tests exercise the same path. Ensure `mockGenerateSupportResponse` resolves a full `pipelineResult` shape (`response`, `formatted.text`, `confidenceScore`, `confidenceLevel`, `latencyMs`, `searchResults`, `tokenUsage`) as that existing test already sets up.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/outpost/queue && npx vitest run src/__tests__/ai-response.test.ts -t "confidence calibration wiring" --reporter=dot`
Expected: FAIL — `generateSupportResponse` called without a `confidenceCalibration` field.

- [ ] **Step 3: Implement the wiring**

Modify `packages/outpost/queue/src/handlers/ai-response.ts`:

3a. Add the import after the other local imports (near line 21):

```ts
import { getFeedbackCalibration } from '../feedback-calibration.js';
```

3b. Replace the pipeline-call block (currently ~line 102-114):

```ts
    let pipelineResult;
    try {
        try {
            pipelineResult = await pipeline.generateSupportResponse(question, {
                source: platform,
                conversationHistory,
            });
        } catch (error) {
```

with:

```ts
    // Read the aggregate feedback calibration; never fail generation because
    // the tally couldn't be read (single fail-soft site).
    let confidenceCalibration = 0;
    try {
        confidenceCalibration = await getFeedbackCalibration(prisma);
    } catch (error) {
        console.error(
            `[AI Response] Failed to read feedback calibration, defaulting to 0: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    console.log(`[AI Response] Confidence calibration: ${confidenceCalibration.toFixed(4)}`);

    let pipelineResult;
    try {
        try {
            pipelineResult = await pipeline.generateSupportResponse(question, {
                source: platform,
                conversationHistory,
                confidenceCalibration,
            });
        } catch (error) {
```

(Leave the rest of the `try` body unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/outpost/queue && npx vitest run src/__tests__/ai-response.test.ts --reporter=dot`
Expected: PASS (existing handler tests + 2 new wiring tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/outpost/queue && npx tsc --noEmit`
Expected: no errors.

```bash
git add packages/outpost/queue/src/handlers/ai-response.ts packages/outpost/queue/src/__tests__/ai-response.test.ts
git commit -m "feat(queue): wire feedback calibration into AI-response pipeline call"
```

---

### Task 5: Full-suite verification

- [ ] **Step 1: Run both package suites**

Run: `cd packages/outpost/ai && npx vitest run --reporter=dot && cd ../queue && npx vitest run --reporter=dot`
Expected: all green.

- [ ] **Step 2: Typecheck both packages**

Run: `cd packages/outpost/ai && npx tsc --noEmit && cd ../queue && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: (No commit)** — verification only; prior tasks already committed.

---

## Self-Review

**Spec coverage:**
- Spec §1 (pure fn) → Task 1. §2 (reader) → Task 3. §3 (pipeline apply) → Task 2. §4 (wiring) → Task 4. §5 (error handling) → reader propagates (Task 3 test 4) + handler fallback (Task 4 test 2). Testing section → tests in Tasks 1-4 + Task 5 full-suite. Rollout (no migration, dormant default) → default `0` in Task 2, no schema change anywhere. ✅ All spec sections covered.

**Placeholder scan:** Task 4's test intentionally references "the existing happy-path fixture" rather than duplicating unknown fixture internals — the implementer note points at a concrete in-file source. All code steps show real code. No TBD/TODO.

**Type consistency:** `computeCalibrationFactor({ positives, negatives })` used identically in Tasks 1 & 3. `confidenceCalibration?: number` defined in Task 2 (`types.ts`) and consumed in Task 4. `getFeedbackCalibration(prisma)` defined Task 3, called Task 4. `FeedbackCountClient` structural type defined and used in Task 3. Consistent.

**Note on Task 2 test fakes:** the fake `generate`/`score` return shapes mirror `generator.ts` / `confidence.ts` at plan time; Step 1's note instructs verifying against `types.ts` and adjusting field names if they differ. This is the one place the implementer must check live types.
