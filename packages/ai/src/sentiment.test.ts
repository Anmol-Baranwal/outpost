import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SentimentLabel } from './types.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
    const createMock = vi.fn();
    return {
        default: class MockAnthropic {
            messages = { create: createMock };
        },
        __createMock: createMock,
    };
});

async function getCreateMock() {
    const mod = await import('@anthropic-ai/sdk') as unknown as {
        __createMock: ReturnType<typeof vi.fn>;
    };
    return mod.__createMock;
}

// Import after mocks
const { analyzeSentiment } = await import('./sentiment.js');

describe('analyzeSentiment', () => {
    beforeEach(async () => {
        const createMock = await getCreateMock();
        createMock.mockReset();
    });

    it('should return NEUTRAL for empty message list', async () => {
        const result = await analyzeSentiment([]);

        expect(result.score).toBe(50);
        expect(result.label).toBe(SentimentLabel.NEUTRAL);
        expect(result.tokenUsage.inputTokens).toBe(0);
    });

    it('should classify positive messages correctly', async () => {
        const createMock = await getCreateMock();
        createMock.mockResolvedValueOnce({
            content: [{
                type: 'text',
                text: JSON.stringify({ score: 10, label: 'POSITIVE' }),
            }],
            usage: { input_tokens: 150, output_tokens: 20 },
        });

        const result = await analyzeSentiment([
            'Thanks so much for your help!',
            'This is working perfectly now.',
        ], { apiKey: 'test-key' });

        expect(result.score).toBe(10);
        expect(result.label).toBe(SentimentLabel.POSITIVE);
        expect(result.tokenUsage.inputTokens).toBe(150);
    });

    it('should classify negative messages correctly', async () => {
        const createMock = await getCreateMock();
        createMock.mockResolvedValueOnce({
            content: [{
                type: 'text',
                text: JSON.stringify({ score: 65, label: 'NEGATIVE' }),
            }],
            usage: { input_tokens: 200, output_tokens: 20 },
        });

        const result = await analyzeSentiment([
            'This is broken again! I reported this last week.',
            'Nothing works, extremely frustrated.',
        ], { apiKey: 'test-key' });

        expect(result.score).toBe(65);
        expect(result.label).toBe(SentimentLabel.NEGATIVE);
    });

    it('should classify critical messages correctly', async () => {
        const createMock = await getCreateMock();
        createMock.mockResolvedValueOnce({
            content: [{
                type: 'text',
                text: JSON.stringify({ score: 85, label: 'CRITICAL' }),
            }],
            usage: { input_tokens: 180, output_tokens: 20 },
        });

        const result = await analyzeSentiment([
            'We are evaluating alternatives. This product is unusable.',
        ], { apiKey: 'test-key' });

        expect(result.score).toBe(85);
        expect(result.label).toBe(SentimentLabel.CRITICAL);
    });

    it('should fall back to NEUTRAL on API failure', async () => {
        const createMock = await getCreateMock();
        createMock.mockRejectedValueOnce(new Error('API rate limit'));

        const result = await analyzeSentiment([
            'Some message content',
        ], { apiKey: 'test-key' });

        expect(result.score).toBe(50);
        expect(result.label).toBe(SentimentLabel.NEUTRAL);
        expect(result.tokenUsage.inputTokens).toBe(0);
    });

    it('should clamp scores to 0-100 range', async () => {
        const createMock = await getCreateMock();
        createMock.mockResolvedValueOnce({
            content: [{
                type: 'text',
                text: JSON.stringify({ score: 150, label: 'CRITICAL' }),
            }],
            usage: { input_tokens: 100, output_tokens: 20 },
        });

        const result = await analyzeSentiment(['test'], { apiKey: 'test-key' });

        expect(result.score).toBe(100);
    });

    it('should derive label from score when label is missing', async () => {
        const createMock = await getCreateMock();
        createMock.mockResolvedValueOnce({
            content: [{
                type: 'text',
                text: JSON.stringify({ score: 15 }),
            }],
            usage: { input_tokens: 100, output_tokens: 20 },
        });

        const result = await analyzeSentiment(['test'], { apiKey: 'test-key' });

        expect(result.score).toBe(15);
        expect(result.label).toBe(SentimentLabel.POSITIVE);
    });

    it('should handle malformed JSON response gracefully', async () => {
        const createMock = await getCreateMock();
        createMock.mockResolvedValueOnce({
            content: [{
                type: 'text',
                text: 'not valid json at all',
            }],
            usage: { input_tokens: 100, output_tokens: 20 },
        });

        const result = await analyzeSentiment(['test'], { apiKey: 'test-key' });

        expect(result.score).toBe(50);
        expect(result.label).toBe(SentimentLabel.NEUTRAL);
        // Token usage still tracked even with parse failure
        expect(result.tokenUsage.inputTokens).toBe(100);
    });

    it('should batch multiple messages into a single API call', async () => {
        const createMock = await getCreateMock();
        createMock.mockResolvedValueOnce({
            content: [{
                type: 'text',
                text: JSON.stringify({ score: 35, label: 'NEUTRAL' }),
            }],
            usage: { input_tokens: 300, output_tokens: 20 },
        });

        await analyzeSentiment([
            'Message 1',
            'Message 2',
            'Message 3',
        ], { apiKey: 'test-key' });

        expect(createMock).toHaveBeenCalledTimes(1);
        // Verify all messages are in the prompt
        const callArgs = createMock.mock.calls[0][0];
        expect(callArgs.messages[0].content).toContain('[Message 1]');
        expect(callArgs.messages[0].content).toContain('[Message 2]');
        expect(callArgs.messages[0].content).toContain('[Message 3]');
    });
});
