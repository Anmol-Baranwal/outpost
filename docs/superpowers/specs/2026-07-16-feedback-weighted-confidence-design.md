# Feedback-Weighted Confidence (Global Calibration)

## Context

The 👍/👎 feedback signal is now captured on both channels — Discord buttons write `Message.feedback` (`apps/discord-bot/src/interactions/buttons.ts`, PR #106) and GitHub reactions are polled into `Message.feedback` (`packages/outpost/queue/src/handlers/github-reaction-poll.ts`, #101). Discord also shows a success ack to the user.

But **nothing consumes `Message.feedback`.** Confidence is scored once, at generation time, by `ConfidenceScorer` (`packages/outpost/ai/src/confidence.ts`) purely from search-result quality against the generated text. The human feedback signal is a dead end — it is stored and never influences future scoring.

This feature closes that loop: the aggregate feedback signal calibrates the confidence score of **future** responses. Sustained 👎 lowers scores (more disclaimers / escalations); sustained 👍 raises them.

Follow-up to issue [#105](https://github.com/CopilotKit/outpost/issues/105). Extends the [#101 confidence + feedback design](./2026-07-15-ai-response-confidence-and-feedback-design.md).

## Goals

1. The aggregate 👍/👎 signal calibrates the confidence score of future AI responses.
2. Calibration is bounded, noise-resistant, and defaults to a no-op until there is enough signal.
3. Zero behavior change when there is no feedback yet (regression-safe rollout).
4. The `ai` package stays DB-free — feedback counts are read by the caller and passed in.

## Non-goals (v1)

- **Per-doc / per-topic weighting.** Global calibration only. A message does not yet record which docs produced it; per-source reputation is a deliberate future slice.
- **Retroactive rescoring** of already-posted messages. Calibration applies only to new responses.
- **UI surfacing** of the current calibration factor (dashboard/analytics). Log-only in v1.
- **Changing the capture or ack.** Discord button ack and GitHub reaction capture are already shipped and unchanged.
- **Persisting the calibration used per message.** Deferred; log-only in v1.

## Design

### 1. Calibration function (pure, `ai` package, no DB)

New module `packages/outpost/ai/src/feedback-calibration.ts`:

```ts
export interface FeedbackTally { positives: number; negatives: number; }

/**
 * Map an aggregate 👍/👎 tally to a bounded confidence adjustment in
 * [-MAX_ADJ, +MAX_ADJ]. Returns 0 until MIN_SAMPLE feedback events exist,
 * so we never calibrate on noise.
 */
export function computeCalibrationFactor(tally: FeedbackTally): number;
```

Algorithm:
- `total = positives + negatives`.
- **Min-sample guard:** `total < MIN_SAMPLE` → return `0`.
- **Laplace-smoothed positive ratio:** `ratio = (positives + 1) / (total + 2)`.
- **Bounded adjustment:** `clamp((ratio - 0.5) * SENSITIVITY, -MAX_ADJ, +MAX_ADJ)`.

Constants (in `packages/outpost/ai/src/config.ts` or a local `const` block, matching how `AI_CONFIDENCE` constants live today):
- `FEEDBACK_MIN_SAMPLE = 20`
- `FEEDBACK_MAX_ADJUSTMENT = 0.15`
- `FEEDBACK_SENSITIVITY = 0.6` — chosen so an all-positive or all-negative steady state saturates at the ±0.15 cap; the exact value is tuned in tests against the boundary cases and is not load-bearing beyond "reaches the cap at the extremes."

Properties: `ratio = 0.5` (balanced) → `0`; all-positive (large n) → `+0.15`; all-negative (large n) → `-0.15`; `total < 20` → `0`.

### 2. Calibration reader (`queue`, has prisma)

New helper `packages/outpost/queue/src/feedback-calibration.ts`:

```ts
export async function getFeedbackCalibration(prisma: PrismaClient): Promise<number>;
```

- Counts `Message` rows where `isAiGenerated = true` and `feedback = 'POSITIVE'` / `'NEGATIVE'` — two `prisma.message.count` calls (or one `groupBy`). Uses the existing `@@index([isAiGenerated, feedback])`.
- Calls `computeCalibrationFactor({ positives, negatives })` and returns the factor.
- One cheap indexed query pair per response at current volume. **Caching noted as future** (in-memory TTL or a periodically-recomputed `SystemConfig` row) — not in v1.
- **Error contract:** the reader does NOT swallow DB errors — it lets them propagate. The single fallback-to-`0` lives in the handler (§4), so there is exactly one fail-soft site.

### 3. Application point (`pipeline`)

`packages/outpost/ai/src/pipeline.ts` `process(options)` gains an optional field:

```ts
confidenceCalibration?: number; // default 0
```

After the existing conservative combine:

```ts
const combined = Math.min(generatedResponse.confidenceScore, confidenceAssessment.score);
const finalConfidenceScore = clamp01(combined + (options.confidenceCalibration ?? 0));
const finalConfidence = classifyConfidence(finalConfidenceScore);
```

`clamp01(x) = Math.max(0, Math.min(1, x))`. Everything downstream (level classification, disclaimer text, `autoSend`/escalation threshold) already keys off `finalConfidenceScore` / `finalConfidence`, so calibration flows through with no other change. **Default `0` reproduces current behavior exactly** — the regression guard.

### 4. Wiring (`ai-response` handler)

`packages/outpost/queue/src/handlers/ai-response.ts` (the sole pipeline caller, has prisma):
- Before `pipeline.process(...)`, call `const calibration = await getFeedbackCalibration(prisma)`.
- Pass `confidenceCalibration: calibration` into `process(...)`.
- Wrap the read in try/catch → on failure, log and fall back to `0` (never fail response generation because calibration couldn't be read — same fail-soft posture as the existing confidence fallback).
- `console.log` the applied factor + the positive/negative counts for observability.

### 5. Error handling & fail-soft

- Reader throws → caught in handler → calibration `0`, response proceeds. Logged.
- Calibration is always finite and bounded by construction; `clamp01` guarantees the final score stays in `[0,1]` even if a bad factor were ever passed.

## Testing

- **`computeCalibrationFactor`** (pure, exhaustive): `total < MIN_SAMPLE` → `0`; all-positive large n → `+MAX_ADJ`; all-negative large n → `-MAX_ADJ`; balanced → `~0`; monotonic in `positives`; output always within `[-MAX_ADJ, +MAX_ADJ]`; smoothing keeps small-but-≥MIN_SAMPLE tallies from saturating.
- **`getFeedbackCalibration`** (mocked prisma): correct count filters (`isAiGenerated`, `feedback`); maps counts → factor; DB error propagates (does not swallow — handler owns the single fallback).
- **`pipeline.process`**: `confidenceCalibration` shifts `finalConfidenceScore`; positive factor can lift LOW→MEDIUM (fewer disclaimers), negative can drop MEDIUM→LOW (more escalations); **default/omitted = identical to pre-change output** (regression guard); final score always clamped to `[0,1]`.
- **`ai-response` handler**: calls `getFeedbackCalibration` and passes the value into `process`; reader failure → calibration `0` and response still posts.

All new behavior gets a test (red-green where it changes behavior). Quiet reporters (`vitest run --reporter=dot`).

## Rollout

- No migration — reuses `Message.feedback` and its existing index.
- Ships dormant: until ≥20 feedback events exist, calibration is `0` and behavior is unchanged.
- Reversible: setting `FEEDBACK_MAX_ADJUSTMENT = 0` (or not passing `confidenceCalibration`) fully disables the effect.

## Open questions

- Constant tuning (`MIN_SAMPLE`, `MAX_ADJUSTMENT`, `SENSITIVITY`) — starting values above; revisit once real feedback volume exists.
- Whether to scope the tally to a recent window (e.g. last 90 days) rather than all-time — deferred; all-time in v1.
