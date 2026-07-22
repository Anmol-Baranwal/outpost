import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { LLMock } from '@copilotkit/aimock';
import { ResponseGenerator, buildChannelGuidance } from './generator.js';
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

const sampleSources: SearchResult[] = [
    {
        title: 'CopilotKit Actions',
        content: 'useCopilotAction lets you define actions...',
        score: 0.92,
        sourceUrl: 'https://docs.copilotkit.ai/actions',
    },
    {
        title: 'Getting Started',
        content: 'Install CopilotKit with npm...',
        score: 0.85,
        sourceUrl: 'https://docs.copilotkit.ai/quickstart',
    },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ResponseGenerator', () => {
    let generator: ResponseGenerator;

    beforeEach(() => {
        generator = new ResponseGenerator({ apiKey: 'test-key' });
    });

    describe('generate', () => {
        it('should generate a response with confidence scoring', async () => {
            mock.onMessage(/./, {
                content: 'Here is how to use CopilotKit actions...',
                usage: { input_tokens: 500, output_tokens: 100 },
            });

            const result = await generator.generate(
                { question: 'How do I use CopilotKit actions?' },
                sampleSources,
            );

            expect(result.text).toBe('Here is how to use CopilotKit actions...');
            expect(result.confidenceScore).toBeGreaterThan(0);
            expect(result.confidenceLevel).toBeDefined();
            expect(result.sources).toEqual(sampleSources);
            expect(result.tokenUsage).toEqual({ inputTokens: 500, outputTokens: 100 });
            expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        });

        it('should assign HIGH confidence for high-quality sources', async () => {
            mock.onMessage(/./, {
                content: 'Response text',
                usage: { input_tokens: 100, output_tokens: 50 },
            });

            const highQualitySources: SearchResult[] = [
                { title: 'A', content: 'Content A', score: 0.95 },
                { title: 'B', content: 'Content B', score: 0.90 },
                { title: 'C', content: 'Content C', score: 0.88 },
            ];

            const result = await generator.generate(
                { question: 'test' },
                highQualitySources,
            );

            expect(result.confidenceLevel).toBe(ConfidenceLevel.HIGH);
        });

        it('should assign LOW confidence when no sources available', async () => {
            mock.onMessage(/./, {
                content: 'I am not sure about this...',
                usage: { input_tokens: 100, output_tokens: 50 },
            });

            const result = await generator.generate(
                { question: 'test' },
                [],
            );

            expect(result.confidenceLevel).toBe(ConfidenceLevel.LOW);
            expect(result.autoSend).toBe(false);
        });

        it('should return graceful fallback on API error', async () => {
            mock.nextRequestError(429, { message: 'API rate limited' });

            const result = await generator.generate(
                { question: 'test' },
                sampleSources,
            );

            expect(result.text).toContain('unable to generate');
            expect(result.confidenceScore).toBe(0);
            expect(result.confidenceLevel).toBe(ConfidenceLevel.LOW);
            expect(result.autoSend).toBe(false);
        });

        it('should include conversation history for follow-ups', async () => {
            mock.onMessage(/./, {
                content: 'Follow-up answer',
                usage: { input_tokens: 200, output_tokens: 50 },
            });

            await generator.generate(
                { question: 'What about streaming?' },
                sampleSources,
                [
                    { role: 'user', content: 'How do I use actions?' },
                    { role: 'assistant', content: 'You use useCopilotAction...' },
                ],
            );

            // Verify the request contained conversation history
            const lastReq = mock.getLastRequest();
            expect(lastReq).not.toBeNull();
            const body = lastReq!.body;
            expect(body).not.toBeNull();
            const messages = body!.messages;
            // Should contain the history messages
            const allMessages = messages as Array<{ role: string; content: string | null }>;
            const userMessages = allMessages.filter(m => m.role === 'user');
            const assistantMessages = allMessages.filter(m => m.role === 'assistant');
            expect(userMessages.some(m =>
                typeof m.content === 'string' && m.content.includes('How do I use actions?')
            )).toBe(true);
            expect(assistantMessages.some(m =>
                typeof m.content === 'string' && m.content.includes('You use useCopilotAction...')
            )).toBe(true);
        });
    });

    describe('buildChannelGuidance', () => {
        it('tells the model not to suggest joining Discord when asked from Discord', () => {
            const guidance = buildChannelGuidance('discord');
            expect(guidance).toContain('Channel Awareness');
            expect(guidance).toContain('ALREADY in Discord');
            expect(guidance).toContain('never suggest they "join the Discord"');
            expect(guidance).toContain('never share a Discord invite link');
        });

        it('tells the model not to suggest opening an issue when asked from GitHub', () => {
            const guidance = buildChannelGuidance('github');
            expect(guidance).toContain('Channel Awareness');
            expect(guidance).toContain('ALREADY on GitHub');
            expect(guidance).toContain('never suggest they "open an issue"');
        });

        it('covers Slack and Teams channels', () => {
            expect(buildChannelGuidance('slack')).toContain('ALREADY in Slack');
            expect(buildChannelGuidance('teams')).toContain('ALREADY in Teams');
        });

        it('returns an empty string when the source is unknown', () => {
            expect(buildChannelGuidance()).toBe('');
            expect(buildChannelGuidance(undefined)).toBe('');
        });

        it('always includes the general do-not-redirect rule for known channels', () => {
            for (const source of ['discord', 'github', 'slack', 'teams', 'web'] as const) {
                expect(buildChannelGuidance(source)).toContain(
                    'never redirect the user to the same channel',
                );
            }
        });
    });

    describe('generateStream', () => {
        it('should yield text chunks from streaming response', async () => {
            mock.onMessage(/./, {
                content: 'Hello world',
                usage: { input_tokens: 100, output_tokens: 10 },
            });

            const chunks: string[] = [];
            for await (const chunk of generator.generateStream(
                { question: 'test' },
                sampleSources,
            )) {
                chunks.push(chunk);
            }

            // aimock streams the content in chunks; joined result should match
            expect(chunks.join('')).toBe('Hello world');
            expect(chunks.length).toBeGreaterThanOrEqual(1);
        });

        it('should yield error message on stream failure', async () => {
            mock.nextRequestError(500, { message: 'Stream interrupted' });

            const chunks: string[] = [];
            for await (const chunk of generator.generateStream(
                { question: 'test' },
                [],
            )) {
                chunks.push(chunk);
            }

            expect(chunks.join('')).toContain('Error generating response');
        });
    });
});
