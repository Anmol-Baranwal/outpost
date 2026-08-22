import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { LLMock } from '@copilotkit/aimock';
import { ConfidenceScorer } from './confidence.js';
import { ConfidenceLevel } from './types.js';
import type { SearchResult } from './types.js';

// ─── aimock setup ───────────────────────────────────────────────────────────

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

// ─── Test data ──────────────────────────────────────────────────────────────

const highQualityResults: SearchResult[] = [
    { title: 'Actions Guide', content: 'Detailed guide...', score: 0.95 },
    { title: 'API Reference', content: 'API docs...', score: 0.90 },
    { title: 'Examples', content: 'Code examples...', score: 0.88 },
];

const lowQualityResults: SearchResult[] = [
    { title: 'Unrelated', content: 'Not relevant...', score: 0.25 },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ConfidenceScorer', () => {
    let scorer: ConfidenceScorer;

    beforeEach(() => {
        scorer = new ConfidenceScorer({ apiKey: 'test-key' });
    });

    describe('score', () => {
        // Same first-block-only defect as the classifier: with thinking on, the
        // score JSON is the SECOND block, so the scorer fell back to its heuristic
        // and the model's judgement was thrown away silently.
        it('should read the score past a leading thinking block', async () => {
            mock.onMessage(/./, {
                content: JSON.stringify({
                    score: 0.9,
                    level: 'HIGH',
                    reasoning: 'Results directly address the question',
                }),
                reasoning: 'internal thinking that is not the score',
                usage: { input_tokens: 200, output_tokens: 30 },
            });

            const result = await scorer.score(
                'How do I use actions?',
                'Here is how to use actions...',
                highQualityResults,
            );

            // The exact score pins that the JSON parsed rather than the heuristic
            // happening to land on the same level.
            expect(result.score).toBe(0.9);
            expect(result.level).toBe(ConfidenceLevel.HIGH);
        });

        it('should return HIGH confidence for well-matched results', async () => {
            mock.onMessage(/./, {
                content: JSON.stringify({
                    score: 0.9,
                    level: 'HIGH',
                    reasoning: 'Results directly address the question',
                }),
                usage: { input_tokens: 200, output_tokens: 30 },
            });

            const result = await scorer.score(
                'How do I use actions?',
                'Here is how to use actions...',
                highQualityResults,
            );

            expect(result.level).toBe(ConfidenceLevel.HIGH);
            expect(result.score).toBe(0.9);
            expect(result.tokenUsage.inputTokens).toBe(200);
        });

        it('should return LOW confidence for poor results', async () => {
            mock.onMessage(/./, {
                content: JSON.stringify({
                    score: 0.3,
                    level: 'LOW',
                    reasoning: 'Search results do not cover the question',
                }),
                usage: { input_tokens: 150, output_tokens: 25 },
            });

            const result = await scorer.score(
                'How do I deploy to Kubernetes?',
                'I could not find specific info...',
                lowQualityResults,
            );

            expect(result.level).toBe(ConfidenceLevel.LOW);
            expect(result.score).toBe(0.3);
        });

        it('should fall back to heuristic scoring on API error', async () => {
            mock.nextRequestError(500, { message: 'API error' });

            const result = await scorer.score(
                'test question',
                'test response',
                highQualityResults,
            );

            // Heuristic should still produce a reasonable score for high-quality results
            expect(result.score).toBeGreaterThan(0.5);
            expect(result.tokenUsage.inputTokens).toBe(0); // Heuristic uses no tokens
        });

        it('should handle malformed Claude response', async () => {
            mock.onMessage(/./, {
                content: 'This is not valid JSON',
                usage: { input_tokens: 100, output_tokens: 20 },
            });

            const result = await scorer.score(
                'test',
                'test response',
                highQualityResults,
            );

            // Should get a fallback MEDIUM score
            expect(result.level).toBe(ConfidenceLevel.MEDIUM);
            expect(result.score).toBe(0.5);
        });

        it('should handle JSON wrapped in code fences', async () => {
            mock.onMessage(/./, {
                content: '```json\n{"score": 0.85, "level": "HIGH", "reasoning": "Good match"}\n```',
                usage: { input_tokens: 100, output_tokens: 20 },
            });

            const result = await scorer.score('test', 'response', highQualityResults);
            expect(result.score).toBe(0.85);
            expect(result.level).toBe(ConfidenceLevel.HIGH);
        });
    });

    describe('heuristicScore', () => {
        it('should return LOW for empty results', () => {
            const result = scorer.heuristicScore([]);
            expect(result.level).toBe(ConfidenceLevel.LOW);
            expect(result.score).toBe(0.2);
        });

        it('should return HIGH for excellent results', () => {
            const result = scorer.heuristicScore(highQualityResults);
            expect(result.level).toBe(ConfidenceLevel.HIGH);
            expect(result.score).toBeGreaterThan(0.8);
        });

        it('should return LOW for poor results', () => {
            const result = scorer.heuristicScore(lowQualityResults);
            expect(result.level).toBe(ConfidenceLevel.LOW);
            expect(result.score).toBeLessThan(0.5);
        });

        it('should factor in result count', () => {
            const singleResult: SearchResult[] = [
                { title: 'One', content: 'One result', score: 0.7 },
            ];
            const manyResults: SearchResult[] = Array.from({ length: 5 }, (_, i) => ({
                title: `Result ${i}`,
                content: `Content ${i}`,
                score: 0.7,
            }));

            const single = scorer.heuristicScore(singleResult);
            const many = scorer.heuristicScore(manyResults);

            expect(many.score).toBeGreaterThan(single.score);
        });
    });
});
