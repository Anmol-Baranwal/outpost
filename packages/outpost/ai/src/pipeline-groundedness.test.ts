import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { LLMock } from '@copilotkit/aimock';

vi.mock('./config.js', () => ({
    config: {
        anthropicApiKey: 'test-key',
        pathfinderMcpUrl: 'http://localhost:8787',
        responseModel: 'claude-sonnet-4-6',
        confidenceModel: 'claude-haiku-4-5-20251001',
        classifierModel: 'claude-haiku-4-5-20251001',
        sentimentModel: 'claude-haiku-4-5-20251001',
        maxResponseTokens: 2048,
        responseTemperature: 0.3,
        confidence: { highThreshold: 0.8, mediumThreshold: 0.5 },
        pathfinder: { defaultLimit: 8, defaultMinScore: 0.3 },
    },
    validateConfig: vi.fn(),
}));

import { AIPipeline } from './pipeline.js';
import { ResponseGenerator } from './generator.js';
import { ResponseFormatter } from './formatter.js';
import { assessGroundedness } from './groundedness.js';
import { ConfidenceLevel } from './types.js';
import type { SearchResult } from './types.js';

/**
 * The groundedness penalty must be applied exactly once, end to end.
 *
 * `pipeline.test.ts` cannot prove this: it injects a mocked `ResponseGenerator`, so
 * `assessConfidence` — one of the two sites that used to deduct — never executes
 * there. The double-application bug was invisible to the entire suite. These tests
 * run the REAL generator against aimock so both sites are live, and assert the
 * arithmetic that only holds when the deduction happens once.
 */

let mock: LLMock;
let originalBaseUrl: string | undefined;

beforeAll(async () => {
    mock = new LLMock({ port: 0 });
    await mock.start();
    originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = mock.url;
});

afterAll(async () => {
    if (originalBaseUrl === undefined) {
        delete process.env.ANTHROPIC_BASE_URL;
    } else {
        process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    }
    await mock.stop();
});

beforeEach(() => {
    mock.reset();
});

/** avg(0.9, 0.85) = 0.875, + count bonus 0.10 → generator retrieval score 0.975. */
const SOURCES: SearchResult[] = [
    {
        title: 'CopilotChat',
        content: 'Use the `input` prop to replace the chat input.',
        score: 0.9,
        category: 'copilotkit-docs',
    },
    {
        title: 'Styling',
        content: 'Theme variables are documented here.',
        score: 0.85,
        category: 'copilotkit-docs',
    },
];

const SCORER_SCORE = 0.95;

/** One invented identifier → penalty 0.15, and NOT suppressed (suppress needs 2). */
const UNGROUNDED_RESPONSE = 'Override `.copilotKitInputControls` to force compact mode.';

function createPipeline() {
    return new AIPipeline({
        pathfinder: {
            searchDocs: vi.fn().mockResolvedValue(SOURCES),
            searchAll: vi.fn().mockResolvedValue(SOURCES),
            exploreDocs: vi.fn(),
            queryKnowledgeBase: vi.fn(),
            disconnect: vi.fn(),
        } as never,
        // The REAL generator — this is the point of the file.
        generator: new ResponseGenerator({ apiKey: 'test-key' }),
        confidenceScorer: {
            score: vi.fn().mockResolvedValue({
                level: ConfidenceLevel.HIGH,
                score: SCORER_SCORE,
                reasoning: 'fixed for arithmetic',
                tokenUsage: { inputTokens: 10, outputTokens: 5 },
                degraded: false,
            }),
            heuristicScore: vi.fn(),
        } as never,
        classifier: { classify: vi.fn(), heuristicClassify: vi.fn() } as never,
        formatter: new ResponseFormatter(),
    });
}

describe('groundedness penalty is applied exactly once', () => {
    it('deducts the penalty a single time through the real generator', async () => {
        mock.onMessage(/./, {
            content: UNGROUNDED_RESPONSE,
            usage: { input_tokens: 100, output_tokens: 50 },
        });

        const pipeline = createPipeline();
        const result = await pipeline.generateSupportResponse('how do I force compact mode?', {
            source: 'github',
        });

        const { penalty } = assessGroundedness(UNGROUNDED_RESPONSE, SOURCES);
        expect(penalty).toBeCloseTo(0.15, 5);

        // min(generator 0.975, scorer 0.95) = 0.95, minus one penalty of 0.15.
        expect(result.confidenceScore).toBeCloseTo(SCORER_SCORE - penalty, 5);

        // The regression this file exists for: two deductions gave 0.80 − 0.15 = 0.65.
        expect(result.confidenceScore).not.toBeCloseTo(SCORER_SCORE - penalty * 2, 5);
    });

    it('leaves the generator score free of the penalty so min() stays meaningful', async () => {
        mock.onMessage(/./, {
            content: UNGROUNDED_RESPONSE,
            usage: { input_tokens: 100, output_tokens: 50 },
        });

        const generator = new ResponseGenerator({ apiKey: 'test-key' });
        const generated = await generator.generate({ question: 'q' }, SOURCES);

        // Retrieval quality only: avg 0.875 + 0.10 count bonus.
        expect(generated.confidenceScore).toBeCloseTo(0.975, 5);
        // The assessment rides along for the pipeline to apply.
        expect(generated.groundedness?.penalty).toBeCloseTo(0.15, 5);
    });

    it('still clamps a suppressed response below the escalation gate', async () => {
        // Two invented identifiers → suppress.
        mock.onMessage(/./, {
            content: 'Override `.copilotKitInputControls` and `.copilotKitInputControlsExpanded`.',
            usage: { input_tokens: 100, output_tokens: 50 },
        });

        const pipeline = createPipeline();
        const result = await pipeline.generateSupportResponse('q', { source: 'github' });

        expect(result.suppressed).toBe(true);
        expect(result.confidenceScore).toBeLessThan(0.4);
    });

    it('leaves a grounded response at full score', async () => {
        mock.onMessage(/./, {
            content: 'Use the `input` prop on CopilotChat to supply your own input component.',
            usage: { input_tokens: 100, output_tokens: 50 },
        });

        const pipeline = createPipeline();
        const result = await pipeline.generateSupportResponse('q', { source: 'github' });

        expect(result.groundedness.penalty).toBe(0);
        expect(result.confidenceScore).toBeCloseTo(SCORER_SCORE, 5);
    });
});
