/**
 * Tests for the AI_RESPONSE job handler.
 *
 * Verifies the full end-to-end flow: ticket loading, AI pipeline execution,
 * classification, message persistence, and escalation triggering.
 * All external dependencies (Prisma, AIPipeline, etc.) are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Mock the feedback-calibration reader so wiring can be asserted in isolation.
const mockGetFeedbackCalibration = vi.fn();
vi.mock('../feedback-calibration.js', () => ({
    getFeedbackCalibration: mockGetFeedbackCalibration,
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

/**
 * Put SHADOW_MODE back exactly as it was, including "it was never set".
 *
 * `process.env.SHADOW_MODE = original` cannot express absence — assigning
 * `undefined` to an env var stores the STRING `"undefined"`, which is truthy for
 * the handler's `process.env.SHADOW_MODE === 'true'`-style reads and, worse,
 * leaks a *defined* var into every test that runs afterwards. Mirrors the
 * delete-when-absent restore in onboarding-digest.test.ts.
 */
function restoreShadowMode(original: string | undefined): void {
    if (original !== undefined) {
        process.env.SHADOW_MODE = original;
    } else {
        delete process.env.SHADOW_MODE;
    }
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
    groundedness: {
        penalty: 0,
        unverifiedClaims: [],
        unsourcedIdentifiers: [],
        hedgeCount: 0,
        suppress: false,
        reasons: [],
    },
    suppressed: false,
};

/** The draft the groundedness check refuses to publish (see #6167). */
const SUPPRESSED_DRAFT =
    '## Bug Confirmed: Cursor Jump\n\nOverride `.copilotKitInputControls` and ' +
    '`.copilotKitInputControlsExpanded`.';

/**
 * Stands in for the pipeline's safe replacement copy. The handler is agnostic to
 * the wording — its contract is "publish `formatted`, whatever it is" — so this
 * fixture only has to be distinguishable from the draft. The real copy is pinned
 * by name (SUPPRESSED_RESPONSE_TEXT) in the AI package's pipeline tests.
 */
const SAFE_REPLACEMENT_FIXTURE = 'I could not find an answer, so I have escalated this.';

/**
 * What the pipeline returns for a suppressed draft: `response` keeps the draft for
 * the human, `formatted` already carries the safe replacement.
 */
const suppressedResult = {
    ...highConfidenceResult,
    response: SUPPRESSED_DRAFT,
    formatted: {
        text: SAFE_REPLACEMENT_FIXTURE,
        truncated: false,
    },
    confidenceLevel: 'LOW',
    confidenceScore: 0.32,
    groundedness: {
        penalty: 0.6,
        unverifiedClaims: ['"bug confirmed"'],
        unsourcedIdentifiers: ['copilotKitInputControls', 'copilotKitInputControlsExpanded'],
        hedgeCount: 0,
        suppress: true,
        reasons: [
            'unverifiable claims: "bug confirmed"',
            'identifiers absent from sources: copilotKitInputControls, copilotKitInputControlsExpanded',
        ],
    },
    suppressed: true,
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
        mockGetFeedbackCalibration.mockResolvedValue(0);
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

    it('reads the calibration factor and passes it into the pipeline', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockGetFeedbackCalibration.mockResolvedValue(0.1);

        await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

        expect(mockGetFeedbackCalibration).toHaveBeenCalled();
        expect(mockGenerateSupportResponse).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ confidenceCalibration: 0.1 }),
        );
    });

    it('falls back to 0 calibration when the reader throws (response still generated)', async () => {
        mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
        mockGetFeedbackCalibration.mockRejectedValue(new Error('db down'));

        const result = await handleAiResponse(
            { ticketId: 'tkt-1', source: 'discord' },
            makeContext(),
        );

        expect(result.success).toBe(true);
        expect(mockGenerateSupportResponse).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ confidenceCalibration: 0 }),
        );
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

    // A suppressed response is one the groundedness check found unsupportable.
    //
    // The handler does NOT gate on suppression — the pipeline already swapped safe
    // copy into `formatted`, so the handler posts unconditionally. That is what
    // these tests pin: the reporter gets the safe replacement and never the draft,
    // a human is pulled in regardless of score, and the draft survives on the
    // ticket for that human. A `suppressed` branch here is what previously made
    // shadow mode drop exactly these records.
    describe('suppressed (ungrounded) responses', () => {
        beforeEach(() => {
            mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);
            mockGenerateSupportResponse.mockResolvedValue(suppressedResult);
            mockHasAdapter.mockReturnValue(true);
        });

        it('posts the safe replacement, never the draft', async () => {
            const result = await handleAiResponse(
                { ticketId: 'tkt-1', source: 'discord' },
                makeContext(),
            );

            expect(result.success).toBe(true);
            expect(result.data?.suppressed).toBe(true);
            // Posts unconditionally — with the pipeline's safe text.
            expect(mockPostResponse).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'tkt-1' }),
                suppressedResult.formatted,
            );
            const posted = mockPostResponse.mock.calls[0][1] as { text: string };
            expect(posted.text).toBe(SAFE_REPLACEMENT_FIXTURE);
            expect(posted.text).not.toContain('Bug Confirmed');
            expect(posted.text).not.toContain('copilotKitInputControls');
        });

        it('escalates to a human even though the score is above ESCALATE', async () => {
            // 0.32 would escalate on score alone, so raise the score above the gate
            // and prove the escalation comes from suppression. Assert on THIS call's
            // return value — asserting on an earlier result would prove nothing.
            mockGenerateSupportResponse.mockResolvedValue({
                ...suppressedResult,
                confidenceScore: 0.95,
                confidenceLevel: 'HIGH',
            });

            const result = await handleAiResponse(
                { ticketId: 'tkt-1', source: 'discord' },
                makeContext(),
            );

            expect(result.data?.confidenceScore).toBe(0.95);
            expect(result.data?.escalated).toBe(true);
            expect(mockPrismaJob.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ type: 'ESCALATION' }),
                }),
            );
            const escalationCall = mockPrismaJob.create.mock.calls[0][0];
            expect(escalationCall.data.payload.reason).toContain('withheld');
        });

        it('still persists the draft so a human can edit and send it', async () => {
            await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

            // The draft — not the replacement — is the BOT message a human works from.
            expect(mockPrismaMessage.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        type: 'BOT',
                        isAiGenerated: true,
                        content: SUPPRESSED_DRAFT,
                    }),
                }),
            );
            // suggestedResponse is what bots pick up, so it holds the safe text.
            expect(mockPrismaTicket.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        suggestedResponse: SAFE_REPLACEMENT_FIXTURE,
                    }),
                }),
            );
        });

        // The regression this whole branch chain rewrite exists for: the old
        // `if (suppressed)` arm ran BEFORE the SHADOW_MODE arm, so in shadow mode a
        // suppressed response produced no shadow record — the responses most worth
        // studying were the only ones that stopped being logged.
        it('records a shadow message in shadow mode', async () => {
            const originalShadow = process.env.SHADOW_MODE;
            try {
                process.env.SHADOW_MODE = 'true';

                const result = await handleAiResponse(
                    { ticketId: 'tkt-1', source: 'discord' },
                    makeContext(),
                );

                expect(result.success).toBe(true);
                expect(mockPostResponse).not.toHaveBeenCalled();
                const shadowCall = mockPrismaMessage.create.mock.calls.find(
                    (call: Array<Record<string, Record<string, unknown>>>) =>
                        call[0].data.author === 'outpost-shadow',
                );
                expect(shadowCall).toBeDefined();
                expect(shadowCall![0].data.content).toBe(SAFE_REPLACEMENT_FIXTURE);
            } finally {
                restoreShadowMode(originalShadow);
            }
        });
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
            restoreShadowMode(originalShadow);
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
            restoreShadowMode(originalShadow);
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

    // ── One response per ticket ───────────────────────────────────────────
    //
    // The invariant: Outpost answers the message that opens a ticket and never
    // posts in that thread again, whoever speaks next. The enqueue sites no
    // longer queue on replies, but this guard is what makes the rule hold — it
    // reads the ticket's own history, so a caller added later cannot route
    // around it.
    //
    // The pipeline is mocked at the class seam here (not driven through LLMock)
    // on purpose: the assertion these tests exist to make is that NO model call
    // happens at all, and `mockGenerateSupportResponse` not being called is the
    // direct expression of that.
    describe('one response per ticket', () => {
        /** A ticket that already carries the AI's single answer. */
        const answeredTicket = {
            ...sampleTicket,
            messages: [
                {
                    id: 'msg-1',
                    type: 'USER',
                    content: 'How do I use CopilotKit with Next.js?',
                    isAiGenerated: false,
                    createdAt: new Date('2026-04-23T10:00:00Z'),
                },
                {
                    id: 'msg-2',
                    type: 'BOT',
                    content: 'Here is how to use CopilotKit with Next.js...',
                    isAiGenerated: true,
                    createdAt: new Date('2026-04-23T10:00:20Z'),
                },
            ],
        };

        it('skips generation when the ticket already has an AI response', async () => {
            mockPrismaTicket.findUnique.mockResolvedValue(answeredTicket);

            const result = await handleAiResponse(
                { ticketId: 'tkt-1', source: 'discord' },
                makeContext(),
            );

            expect(result.success).toBe(true);
            expect(result.data).toMatchObject({ skipped: true, reason: 'already_answered' });
            expect(mockGenerateSupportResponse).not.toHaveBeenCalled();
        });

        it('does not post anything to the platform for an already-answered ticket', async () => {
            mockPrismaTicket.findUnique.mockResolvedValue(answeredTicket);

            await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

            expect(mockPostResponse).not.toHaveBeenCalled();
            expect(mockPrismaMessage.create).not.toHaveBeenCalled();
            expect(mockPrismaTicket.update).not.toHaveBeenCalled();
        });

        it('reports success so the job is not retried forever', async () => {
            mockPrismaTicket.findUnique.mockResolvedValue(answeredTicket);

            const result = await handleAiResponse(
                { ticketId: 'tkt-1', source: 'discord' },
                makeContext(),
            );

            // A failure verdict would put an unchangeable decision through the
            // retry ladder. Asserting `skipped` alongside it matters: without it
            // this test also passes on the ordinary answer path, so it would
            // stop proving anything if the guard were removed.
            expect(result.success).toBe(true);
            expect(result.error).toBeUndefined();
            expect(result.data).toMatchObject({ skipped: true });
        });

        it('skips even when a human replied after the AI response', async () => {
            // The exact case that prompted this: a maintainer posted the real
            // solution, and the bot answered again 14 seconds later.
            mockPrismaTicket.findUnique.mockResolvedValue({
                ...answeredTicket,
                messages: [
                    ...answeredTicket.messages,
                    {
                        id: 'msg-3',
                        type: 'USER',
                        content: 'Here is the actual fix, from a maintainer.',
                        isAiGenerated: false,
                        createdAt: new Date('2026-05-06T20:06:09Z'),
                    },
                ],
            });

            const result = await handleAiResponse(
                { ticketId: 'tkt-1', source: 'discord' },
                makeContext(),
            );

            expect(result.data).toMatchObject({ skipped: true });
            expect(mockGenerateSupportResponse).not.toHaveBeenCalled();
        });

        it('still answers a ticket whose only messages are from users', async () => {
            // Guard must not swallow the first, legitimate response.
            mockPrismaTicket.findUnique.mockResolvedValue(sampleTicket);

            const result = await handleAiResponse(
                { ticketId: 'tkt-1', source: 'discord' },
                makeContext(),
            );

            expect(result.data).not.toMatchObject({ skipped: true });
            expect(mockGenerateSupportResponse).toHaveBeenCalled();
            expect(mockPostResponse).toHaveBeenCalled();
        });

        it('does not treat a SYSTEM shadow-mode log as the ticket answer', async () => {
            // Shadow mode writes SYSTEM + isAiGenerated rows alongside the BOT
            // row. Only the BOT row means "the reporter has been answered", so a
            // ticket carrying just a SYSTEM row must still be answerable.
            mockPrismaTicket.findUnique.mockResolvedValue({
                ...sampleTicket,
                messages: [
                    ...sampleTicket.messages,
                    {
                        id: 'msg-shadow',
                        type: 'SYSTEM',
                        content: 'shadow log',
                        isAiGenerated: true,
                        createdAt: new Date('2026-04-23T10:00:10Z'),
                    },
                ],
            });

            await handleAiResponse({ ticketId: 'tkt-1', source: 'discord' }, makeContext());

            expect(mockGenerateSupportResponse).toHaveBeenCalled();
        });
    });
});

/**
 * The shadow-mode tests above set SHADOW_MODE and hand it back in a `finally`.
 * Getting the hand-back wrong does not fail those tests — it silently defines
 * SHADOW_MODE for every test that runs afterwards, because assigning `undefined`
 * to `process.env.X` stores the string `"undefined"`. So the restore itself is
 * pinned here rather than left to trust.
 */
describe('restoreShadowMode', () => {
    const beforeEachTest = process.env.SHADOW_MODE;
    afterEach(() => {
        restoreShadowMode(beforeEachTest);
    });

    it('unsets SHADOW_MODE entirely when it was never set', () => {
        delete process.env.SHADOW_MODE;
        const original = process.env.SHADOW_MODE;
        process.env.SHADOW_MODE = 'true';

        restoreShadowMode(original);

        expect('SHADOW_MODE' in process.env).toBe(false);
        expect(process.env.SHADOW_MODE).toBeUndefined();
    });

    it('puts the original value back when it was set', () => {
        process.env.SHADOW_MODE = 'false';
        const original = process.env.SHADOW_MODE;
        process.env.SHADOW_MODE = 'true';

        restoreShadowMode(original);

        expect(process.env.SHADOW_MODE).toBe('false');
    });
});
