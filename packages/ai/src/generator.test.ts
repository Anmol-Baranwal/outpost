import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResponseGenerator } from './generator.js';
import { ConfidenceLevel } from './types.js';
import type { SearchResult } from './types.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
    const createMock = vi.fn();
    const streamMock = vi.fn();
    return {
        default: class MockAnthropic {
            messages = {
                create: createMock,
                stream: streamMock,
            };
        },
        __createMock: createMock,
        __streamMock: streamMock,
    };
});

// Get references to the mocks
async function getMocks() {
    const mod = await import('@anthropic-ai/sdk') as unknown as {
        __createMock: ReturnType<typeof vi.fn>;
        __streamMock: ReturnType<typeof vi.fn>;
    };
    return { createMock: mod.__createMock, streamMock: mod.__streamMock };
}

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

describe('ResponseGenerator', () => {
    let generator: ResponseGenerator;

    beforeEach(async () => {
        const { createMock } = await getMocks();
        createMock.mockReset();

        generator = new ResponseGenerator({ apiKey: 'test-key' });
    });

    describe('generate', () => {
        it('should generate a response with confidence scoring', async () => {
            const { createMock } = await getMocks();
            createMock.mockResolvedValueOnce({
                content: [{ type: 'text', text: 'Here is how to use CopilotKit actions...' }],
                usage: { input_tokens: 500, output_tokens: 100 },
            });

            const result = await generator.generate(
                { question: 'How do I use CopilotKit actions?' },
                sampleSources,
            );

            expect(result.text).toBe('Here is how to use CopilotKit actions...');
            expect(result.confidence).toBeGreaterThan(0);
            expect(result.confidenceLevel).toBeDefined();
            expect(result.sources).toEqual(sampleSources);
            expect(result.tokenUsage).toEqual({ inputTokens: 500, outputTokens: 100 });
            expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        });

        it('should assign HIGH confidence for high-quality sources', async () => {
            const { createMock } = await getMocks();
            createMock.mockResolvedValueOnce({
                content: [{ type: 'text', text: 'Response text' }],
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
            const { createMock } = await getMocks();
            createMock.mockResolvedValueOnce({
                content: [{ type: 'text', text: 'I am not sure about this...' }],
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
            const { createMock } = await getMocks();
            createMock.mockRejectedValueOnce(new Error('API rate limited'));

            const result = await generator.generate(
                { question: 'test' },
                sampleSources,
            );

            expect(result.text).toContain('unable to generate');
            expect(result.confidence).toBe(0);
            expect(result.confidenceLevel).toBe(ConfidenceLevel.LOW);
            expect(result.autoSend).toBe(false);
        });

        it('should include conversation history for follow-ups', async () => {
            const { createMock } = await getMocks();
            createMock.mockResolvedValueOnce({
                content: [{ type: 'text', text: 'Follow-up answer' }],
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

            expect(createMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    messages: expect.arrayContaining([
                        { role: 'user', content: 'How do I use actions?' },
                        { role: 'assistant', content: 'You use useCopilotAction...' },
                    ]),
                }),
            );
        });
    });

    describe('generateStream', () => {
        it('should yield text chunks from streaming response', async () => {
            const { streamMock } = await getMocks();

            // Create an async iterable that yields stream events
            const events = [
                { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
                { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
                { type: 'message_stop' },
            ];

            streamMock.mockReturnValueOnce({
                [Symbol.asyncIterator]: async function* () {
                    for (const event of events) {
                        yield event;
                    }
                },
            });

            const chunks: string[] = [];
            for await (const chunk of generator.generateStream(
                { question: 'test' },
                sampleSources,
            )) {
                chunks.push(chunk);
            }

            expect(chunks).toEqual(['Hello', ' world']);
        });

        it('should yield error message on stream failure', async () => {
            const { streamMock } = await getMocks();
            streamMock.mockReturnValueOnce({
                [Symbol.asyncIterator]: async function* () {
                    throw new Error('Stream interrupted');
                },
            });

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
