/**
 * Tests for the AI_RESPONSE job handler.
 *
 * Verifies the full end-to-end flow: ticket loading, AI pipeline execution,
 * classification, message persistence, and escalation triggering.
 * All external dependencies (Prisma, AIPipeline, etc.) are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JobHandlerContext } from '../types.js';

// ─── Mock Setup ─────────────────────────────────────────────────────────────

const mockPrismaTicket = {
    findUnique: vi.fn(),
    update: vi.fn(),
};

const mockPrismaMessage = {
    create: vi.fn(),
    update: vi.fn(),
};

const mockPrismaJob = {
    create: vi.fn(),
};

const mockPrisma = {
    ticket: mockPrismaTicket,
    message: mockPrismaMessage,
    job: mockPrismaJob,
};

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: mockPrisma,
}));

// Mock AI pipeline
const mockGenerateSupportResponse = vi.fn();
const mockClassifyTicket = vi.fn();
const mockDestroy = vi.fn();

class MockAIPipeline {
    generateSupportResponse = mockGenerateSupportResponse;
    classifyTicket = mockClassifyTicket;
    destroy = mockDestroy;
}

vi.mock('@copilotkit/outpost/ai', () => ({
    AIPipeline: MockAIPipeline,
}));

const mockPostResponse = vi.fn().mockResolvedValue(undefined);
const mockHasAdapter = vi.fn().mockReturnValue(true);
const mockGetAdapter = vi.fn().mockReturnValue({
    platform: 'DISCORD',
    postResponse: mockPostResponse,
    postSystemMessage: vi.fn(),
    parseInboundEvent: vi.fn(),
    fetchUserInfo: vi.fn(),
});

vi.mock('@copilotkit/outpost/shared', () => ({
    AI_CONFIDENCE: {
        AUTO_RESPOND: 0.9,
        HIGH_THRESHOLD: 0.8,
        SUGGEST: 0.7,
        MEDIUM_THRESHOLD: 0.5,
        ESCALATE: 0.4,
    },
    MAX_JOB_ATTEMPTS: 5,
    BACKOFF_BASE_MS: 1000,
    BACKOFF_MAX_MS: 300_000,
    calculateBackoff: (attempt: number) => 1000 * Math.pow(2, attempt),
}));

vi.mock('@copilotkit/outpost/shared/platforms', () => ({
    hasAdapter: mockHasAdapter,
    getAdapter: mockGetAdapter,
}));

// Import after mocks
const { handleAiResponse } = await import('../handlers/ai-response.js');

// ─── Test Helpers ──────────────────────────────────────────────────────────

function makeContext(): JobHandlerContext {
    return {
        jobId: 'test-job-1',
        reportProgress: vi.fn().mockResolvedValue(undefined),
    };
}

const sampleTicket = {
    id: 'tkt-1',
    displayId: 'TKT-0001',
    title: 'How do I use CopilotKit with Next.js?',
    description: 'I want to add AI features to my Next.js app using CopilotKit.',
    status: 'OPEN',
    priority: 'MEDIUM',
    type: 'QUESTION',
    source: 'DISCORD',
    sourceId: 'thread-123',
    channel: 'channel-456',
    suggestedResponse: null,
    account: {
        id: 'acct-1',
        name: 'Test Corp',
    },
    user: {
        id: 'user-1',
        name: 'Test User',
    },
    messages: [
        {
            id: 'msg-1',
            type: 'USER',
            content: 'How do I use CopilotKit with Next.js?',
            createdAt: new Date('2026-04-23T10:00:00Z'),
        },
    ],
};

const highConfidenceResult = {
    response: 'Here is how to use CopilotKit with Next.js...',
    formatted: {
        text: 'Here is how to use CopilotKit with Next.js...\n\n---\n*Powered by CopilotKit AI*',
        truncated: false,
    },
    confidenceLevel: 'HIGH',
    confidenceScore: 0.92,
    searchResults: [{ title: 'Getting Started', content: '...', score: 0.95 }],
    tokenUsage: { inputTokens: 100, outputTokens: 200 },
    latencyMs: 1500,
};

const mediumConfidenceResult = {
    ...highConfidenceResult,
    confidenceLevel: 'MEDIUM',
    confidenceScore: 0.65,
};

const lowConfidenceResult = {
    ...highConfidenceResult,
    confidenceLevel: 'LOW',
    confidenceScore: 0.25,
};

const sampleClassification = {
    priority: 'LOW',
    type: 'QUESTION',
    tags: ['next.js', 'copilotkit-runtime'],
    reasoning: 'A question about integrating CopilotKit with Next.js',
    tokenUsage: { inputTokens: 50, outputTokens: 30 },
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('handleAiResponse', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPrismaTicket.update.mockResolvedValue({});
        mockPrismaMessage.create.mockResolvedValue({ id: 'msg-new' });
        mockPrismaMessage.update.mockResolvedValue({});
        mockPrismaJob.create.mockResolvedValue({ id: 'job-esc-1' });
        mockGenerateSupportResponse.mockResolvedValue(highConfidenceResult);
        mockClassifyTicket.mockResolvedValue(sampleClassification);
        mockPostResponse.mockResolvedValue(undefined);
        mockHasAdapter.mockReturnValue(true);
        mockGetAdapter.mockReturnValue({
            platform: 'DISCORD',
            postResponse: mockPostResponse,
            postSystemMessage: vi.fn(),
            parseInboundEvent: vi.fn(),
            fetchUserInfo: vi.fn(),
        });
    });

    it('processes a ticket end-to-end with high confidence', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);

        const result = await handleAiResponse(
            { ticketId: 'tkt-1', source: 'discord' },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(result.data?.confidenceLevel).toBe('HIGH');
        expect(result.data?.confidenceScore).toBe(0.92);
        expect(result.data?.escalated).toBe(false);

        // Pipeline should have been called with the latest user message
        expect(mockGenerateSupportResponse).toHaveBeenCalledWith(
            'How do I use CopilotKit with Next.js?',
            expect.objectContaining({
                source: 'discord',
                conversationHistory: expect.arrayContaining([
                    expect.objectContaining({
                        role: 'user',
                        content: 'How do I use CopilotKit with Next.js?',
                    }),
                ]),
            }),
        );
    });

    it('returns failure when ticket is not found', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(null);

        const result = await handleAiResponse(
            { ticketId: 'nonexistent', source: 'discord' },
            makeContext(),
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
        // Pipeline should NOT have been called
        expect(mockGenerateSupportResponse).not.toHaveBeenCalled();
    });

    it('triggers escalation when confidence is below ESCALATE threshold', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockGenerateSupportResponse.mockResolvedValue(lowConfidenceResult);

        const result = await handleAiResponse(
            { ticketId: 'tkt-1', source: 'discord' },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(result.data?.escalated).toBe(true);

        // Should have created an ESCALATION job via createJob
        expect(mockPrismaJob.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    type: 'ESCALATION',
                }),
            }),
        );
        // Verify the payload contains the ticket ID and reason
        const escalationCall = mockPrismaJob.create.mock.calls[0][0];
        expect(escalationCall.data.payload).toEqual(
            expect.objectContaining({
                ticketId: 'tkt-1',
                reason: expect.stringContaining('Low AI confidence'),
            }),
        );
    });

    it('does not escalate when confidence is above ESCALATE threshold', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockGenerateSupportResponse.mockResolvedValue(mediumConfidenceResult);

        const result = await handleAiResponse(
            { ticketId: 'tkt-1', source: 'discord' },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(result.data?.escalated).toBe(false);

        // Should NOT have created an ESCALATION job
        expect(mockPrismaJob.create).not.toHaveBeenCalled();
    });

    it('classifies the ticket and updates DB', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);

        await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

        // Should have called classifyTicket
        expect(mockClassifyTicket).toHaveBeenCalledWith(
            expect.stringContaining('How do I use CopilotKit'),
        );

        // Should have updated ticket with classification results
        expect(mockPrismaTicket.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'tkt-1' },
                data: expect.objectContaining({
                    priority: 'LOW',
                    type: 'QUESTION',
                }),
            }),
        );
    });

    it('persists the AI-generated response as a BOT message', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);

        await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

        expect(mockPrismaMessage.create).toHaveBeenCalledWith({
            data: {
                ticketId: 'tkt-1',
                content: 'Here is how to use CopilotKit with Next.js...',
                type: 'BOT',
                author: 'Outpost AI',
                isAiGenerated: true,
                confidenceScore: 0.92,
                confidenceLevel: 'HIGH',
            },
        });
    });

    it('persists confidenceScore and confidenceLevel on the created Message', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockGenerateSupportResponse.mockResolvedValue({
            ...highConfidenceResult,
            confidenceScore: 0.75,
            confidenceLevel: 'HIGH',
        });

        await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

        expect(mockPrismaMessage.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    confidenceScore: 0.75,
                    confidenceLevel: 'HIGH',
                }),
            }),
        );
    });

    it('persists externalCommentId when the adapter returns one', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockPrismaMessage.create.mockResolvedValue({ id: 'msg-new' });
        mockHasAdapter.mockReturnValue(true);
        mockPostResponse.mockResolvedValue('999888');

        await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

        expect(mockPrismaMessage.update).toHaveBeenCalledWith({
            where: { id: 'msg-new' },
            data: { externalCommentId: '999888' },
        });
    });

    it('stores formatted response as suggestedResponse on ticket', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);

        await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

        // Find the update call that sets suggestedResponse
        const suggestedResponseCall = mockPrismaTicket.update.mock.calls.find(
            (call: Array<Record<string, Record<string, unknown>>>) =>
                call[0].data.suggestedResponse !== undefined,
        );
        expect(suggestedResponseCall).toBeDefined();
        expect(suggestedResponseCall![0].data.suggestedResponse).toContain(
            'Here is how to use CopilotKit with Next.js',
        );
    });

    it('handles pipeline generation failure gracefully', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockGenerateSupportResponse.mockRejectedValue(new Error('Claude API rate limit'));

        const result = await handleAiResponse(
            { ticketId: 'tkt-1', source: 'discord' },
            makeContext(),
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Claude API rate limit');
        expect(mockDestroy).toHaveBeenCalled();
    });

    it('continues if classification fails (non-fatal)', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockClassifyTicket.mockRejectedValue(new Error('Classifier timeout'));

        const result = await handleAiResponse(
            { ticketId: 'tkt-1', source: 'discord' },
            makeContext(),
        );

        // Should still succeed — classification is non-fatal
        expect(result.success).toBe(true);
        // Message should still have been created
        expect(mockPrismaMessage.create).toHaveBeenCalled();
    });

    it('reports progress throughout execution', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);

        const ctx = makeContext();
        await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, ctx);

        expect(ctx.reportProgress).toHaveBeenCalledWith(10);
        expect(ctx.reportProgress).toHaveBeenCalledWith(20);
        expect(ctx.reportProgress).toHaveBeenCalledWith(50);
        expect(ctx.reportProgress).toHaveBeenCalledWith(70);
        expect(ctx.reportProgress).toHaveBeenCalledWith(85);
        expect(ctx.reportProgress).toHaveBeenCalledWith(100);
    });

    it('maps TicketSource to PlatformTarget correctly', async () => {
        // Test with a GitHub ticket (source should map to 'github')
        const githubTicket = {
            ...sampleTicket,
            source: 'GITHUB_ISSUE',
        };
        mockPrismaTicket.findUnique.mockResolvedValue(githubTicket);

        // When payload.source is not set, should derive from ticket.source
        await handleAiResponse({ ticketId: 'tkt-1', source: undefined }, makeContext());

        expect(mockGenerateSupportResponse).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ source: 'github' }),
        );
    });

    it('uses payload.source when provided, overriding ticket source', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);

        await handleAiResponse({ ticketId: 'tkt-1', source: 'slack' }, makeContext());

        expect(mockGenerateSupportResponse).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ source: 'slack' }),
        );
    });

    it('uses ticket description as question when no user messages exist', async () => {
        const ticketNoMessages = {
            ...sampleTicket,
            messages: [],
        };
        mockPrismaTicket.findUnique.mockResolvedValue(ticketNoMessages);

        await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

        expect(mockGenerateSupportResponse).toHaveBeenCalledWith(
            'I want to add AI features to my Next.js app using CopilotKit.',
            expect.anything(),
        );
    });

    it('cleans up pipeline on success', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);

        await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

        expect(mockDestroy).toHaveBeenCalledOnce();
    });

    it('posts the formatted response back to the source platform', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockHasAdapter.mockReturnValue(true);

        await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

        expect(mockGetAdapter).toHaveBeenCalledWith('DISCORD');
        expect(mockPostResponse).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'tkt-1',
                sourceId: 'thread-123',
                channel: 'channel-456',
                source: 'DISCORD',
            }),
            expect.objectContaining({
                text: expect.stringContaining('CopilotKit'),
            }),
        );
    });

    it('skips post-back when platform has no adapter', async () => {
        const webTicket = { ...sampleTicket, source: 'WEB' };
        mockPrismaTicket.findUnique.mockResolvedValue(webTicket);
        mockHasAdapter.mockReturnValue(false);

        const result = await handleAiResponse({ ticketId: 'tkt-1', source: 'web' }, makeContext());

        expect(result.success).toBe(true);
        expect(mockPostResponse).not.toHaveBeenCalled();
    });

    it('skips post-back in shadow mode', async () => {
        const originalShadow = process.env.SHADOW_MODE;
        try {
            process.env.SHADOW_MODE = 'true';
            mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);

            const result = await handleAiResponse(
                { ticketId: 'tkt-1', source: 'discord' },
                makeContext(),
            );

            expect(result.success).toBe(true);
            expect(mockPostResponse).not.toHaveBeenCalled();
            // Shadow response should be logged as a SYSTEM message
            const shadowMessageCall = mockPrismaMessage.create.mock.calls.find(
                (call: Array<Record<string, Record<string, unknown>>>) =>
                    call[0].data.author === 'outpost-shadow',
            );
            expect(shadowMessageCall).toBeDefined();
        } finally {
            process.env.SHADOW_MODE = originalShadow;
        }
    });

    it('succeeds even if post-back fails (non-fatal)', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockHasAdapter.mockReturnValue(true);
        mockPostResponse.mockRejectedValueOnce(new Error('Discord API 503'));

        const result = await handleAiResponse(
            { ticketId: 'tkt-1', source: 'discord' },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(result.data?.confidenceLevel).toBe('HIGH');
    });

    it('succeeds when getAdapter throws (adapter misconfiguration)', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockHasAdapter.mockReturnValue(true);
        mockGetAdapter.mockImplementation(() => {
            throw new Error('Missing DISCORD_BOT_TOKEN');
        });

        const result = await handleAiResponse(
            { ticketId: 'tkt-1', source: 'discord' },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(mockPostResponse).not.toHaveBeenCalled();
    });

    it('succeeds even if shadow mode message logging fails', async () => {
        const originalShadow = process.env.SHADOW_MODE;
        try {
            process.env.SHADOW_MODE = 'true';
            mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
            mockPrismaMessage.create
                .mockResolvedValueOnce({ id: 'msg-bot' })
                .mockRejectedValueOnce(new Error('DB write failed'));

            const result = await handleAiResponse(
                { ticketId: 'tkt-1', source: 'discord' },
                makeContext(),
            );

            expect(result.success).toBe(true);
        } finally {
            process.env.SHADOW_MODE = originalShadow;
        }
    });

    it('falls back to "web" for unknown TicketSource values', async () => {
        const unknownSourceTicket = { ...sampleTicket, source: 'INTERCOM' };
        mockPrismaTicket.findUnique.mockResolvedValue(unknownSourceTicket);
        mockHasAdapter.mockReturnValue(false);

        await handleAiResponse({ ticketId: 'tkt-1', source: undefined }, makeContext());

        expect(mockGenerateSupportResponse).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ source: 'web' }),
        );
    });

    it('uses ticket title as question when no messages and description is null', async () => {
        const ticketTitleOnly = {
            ...sampleTicket,
            messages: [],
            description: null,
        };
        mockPrismaTicket.findUnique.mockResolvedValue(ticketTitleOnly);

        await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

        expect(mockGenerateSupportResponse).toHaveBeenCalledWith(
            'How do I use CopilotKit with Next.js?',
            expect.anything(),
        );
    });

    it('does not escalate when confidence equals ESCALATE threshold exactly', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockGenerateSupportResponse.mockResolvedValue({
            ...highConfidenceResult,
            confidenceLevel: 'LOW',
            confidenceScore: 0.4,
        });

        const result = await handleAiResponse(
            { ticketId: 'tkt-1', source: 'discord' },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(result.data?.escalated).toBe(false);
        expect(mockPrismaJob.create).not.toHaveBeenCalled();
    });

    it('filters SYSTEM messages from conversation history', async () => {
        const multiMsgTicket = {
            ...sampleTicket,
            messages: [
                {
                    id: 'msg-1',
                    type: 'USER',
                    content: 'Hello',
                    createdAt: new Date('2026-04-23T10:00:00Z'),
                },
                {
                    id: 'msg-2',
                    type: 'BOT',
                    content: 'Hi there!',
                    createdAt: new Date('2026-04-23T10:01:00Z'),
                },
                {
                    id: 'msg-3',
                    type: 'SYSTEM',
                    content: 'Ticket escalated',
                    createdAt: new Date('2026-04-23T10:02:00Z'),
                },
                {
                    id: 'msg-4',
                    type: 'USER',
                    content: 'Follow up question',
                    createdAt: new Date('2026-04-23T10:03:00Z'),
                },
            ],
        };
        mockPrismaTicket.findUnique.mockResolvedValue(multiMsgTicket);

        await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

        expect(mockGenerateSupportResponse).toHaveBeenCalledWith(
            'Follow up question',
            expect.objectContaining({
                conversationHistory: [
                    { role: 'user', content: 'Hello' },
                    { role: 'assistant', content: 'Hi there!' },
                    { role: 'user', content: 'Follow up question' },
                ],
            }),
        );
    });
});
