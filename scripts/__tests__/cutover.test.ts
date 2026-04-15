import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock PrismaClient ──────────────────────────────────────────────────────

function makePrismaMock() {
    return {
        $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
        $disconnect: vi.fn().mockResolvedValue(undefined),
        ticket: {
            count: vi.fn().mockResolvedValue(100),
            findMany: vi.fn().mockResolvedValue([]),
        },
        message: {
            findMany: vi.fn().mockResolvedValue([]),
        },
    };
}

// ─── Mock modules ───────────────────────────────────────────────────────────

vi.mock('@prisma/client', () => ({
    PrismaClient: vi.fn().mockImplementation(() => makePrismaMock()),
}));

// We need to import after mocking
import { validateQuality } from '../cutover/validate-quality.js';
import {
    runHealthChecks,
    runQualityValidation,
    verifyTicketData,
    executeCutover,
} from '../cutover/execute-cutover.js';
import { executeRollback } from '../cutover/rollback.js';

describe('validate-quality', () => {
    it('returns NEEDS_MORE_DATA when shadow responses are below minimum', async () => {
        const prisma = makePrismaMock();
        prisma.message.findMany.mockResolvedValue([]);
        prisma.ticket.findMany.mockResolvedValue([]);

        const metrics = await validateQuality(prisma as never, {
            since: null,
            minSample: 20,
        });

        expect(metrics.recommendation).toBe('NEEDS_MORE_DATA');
        expect(metrics.reasons[0]).toContain('Only 0 shadow responses');
    });

    it('returns READY when sufficient high-quality shadow responses exist', async () => {
        const shadowMessages = Array.from({ length: 25 }, (_, i) => ({
            id: `msg-${i}`,
            ticketId: `ticket-${i}`,
            author: 'outpost-shadow',
            content: `Here's how to fix it:\n\`\`\`js\nconsole.log("hello")\n\`\`\`\nSee https://docs.example.com for more.`,
            type: 'NOTE',
            isAiGenerated: true,
            attachments: {
                shadowMode: true,
                threadId: `thread-${i}`,
                responseTimeMs: 3000,
                generatedAt: new Date().toISOString(),
            },
            ticket: { id: `ticket-${i}` },
        }));

        const prisma = makePrismaMock();
        prisma.message.findMany.mockResolvedValue(shadowMessages);
        prisma.ticket.findMany.mockResolvedValue([]);

        const metrics = await validateQuality(prisma as never, {
            since: null,
            minSample: 20,
        });

        expect(metrics.recommendation).toBe('READY');
        expect(metrics.ticketsWithShadowResponses).toBe(25);
    });

    it('returns NOT_READY when response time exceeds target', async () => {
        const shadowMessages = Array.from({ length: 25 }, (_, i) => ({
            id: `msg-${i}`,
            ticketId: `ticket-${i}`,
            author: 'outpost-shadow',
            content: 'A response.',
            type: 'NOTE',
            isAiGenerated: true,
            attachments: {
                shadowMode: true,
                threadId: `thread-${i}`,
                responseTimeMs: 700000, // > 10 minutes
                generatedAt: new Date().toISOString(),
            },
            ticket: { id: `ticket-${i}` },
        }));

        const prisma = makePrismaMock();
        prisma.message.findMany.mockResolvedValue(shadowMessages);
        prisma.ticket.findMany.mockResolvedValue([]);

        const metrics = await validateQuality(prisma as never, {
            since: null,
            minSample: 20,
        });

        expect(metrics.recommendation).toBe('NOT_READY');
        expect(metrics.reasons.some((r: string) => r.includes('response time'))).toBe(true);
    });

    it('returns NOT_READY when low confidence rate is too high', async () => {
        const shadowMessages = Array.from({ length: 25 }, (_, i) => ({
            id: `msg-${i}`,
            ticketId: `ticket-${i}`,
            author: 'outpost-shadow',
            content: "I'm not sure about this. I don't know the answer. Unfortunately I cannot help.",
            type: 'NOTE',
            isAiGenerated: true,
            attachments: {
                shadowMode: true,
                threadId: `thread-${i}`,
                responseTimeMs: 3000,
                generatedAt: new Date().toISOString(),
            },
            ticket: { id: `ticket-${i}` },
        }));

        const prisma = makePrismaMock();
        prisma.message.findMany.mockResolvedValue(shadowMessages);
        prisma.ticket.findMany.mockResolvedValue([]);

        const metrics = await validateQuality(prisma as never, {
            since: null,
            minSample: 20,
        });

        expect(metrics.recommendation).toBe('NOT_READY');
        expect(metrics.reasons.some((r: string) => r.includes('low confidence'))).toBe(true);
    });
});

describe('execute-cutover', () => {
    describe('runHealthChecks', () => {
        it('passes when database is connected and env vars are set', async () => {
            const prisma = makePrismaMock();
            process.env.DATABASE_URL = 'postgres://test';
            process.env.DISCORD_TOKEN = 'test-token';
            process.env.DISCORD_CLIENT_ID = 'test-client-id';
            process.env.GUILD_ID = 'test-guild-id';

            const result = await runHealthChecks(prisma as never);

            expect(result.status).toBe('PASS');
        });

        it('fails when database connection fails', async () => {
            const prisma = makePrismaMock();
            prisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));

            const result = await runHealthChecks(prisma as never);

            expect(result.status).toBe('FAIL');
            expect(result.message).toContain('Connection refused');
        });

        it('fails when required env vars are missing', async () => {
            const prisma = makePrismaMock();
            delete process.env.DISCORD_TOKEN;

            const result = await runHealthChecks(prisma as never);

            expect(result.status).toBe('FAIL');
            expect(result.message).toContain('DISCORD_TOKEN');
        });
    });

    describe('verifyTicketData', () => {
        it('passes when tickets exist', async () => {
            const prisma = makePrismaMock();
            prisma.ticket.count
                .mockResolvedValueOnce(150) // total
                .mockResolvedValueOnce(100) // discord
                .mockResolvedValueOnce(50);  // orca

            const result = await verifyTicketData(prisma as never);

            expect(result.status).toBe('PASS');
            expect(result.message).toContain('150');
        });

        it('fails when no tickets exist', async () => {
            const prisma = makePrismaMock();
            prisma.ticket.count.mockResolvedValue(0);

            const result = await verifyTicketData(prisma as never);

            expect(result.status).toBe('FAIL');
        });
    });

    describe('executeCutover', () => {
        beforeEach(() => {
            process.env.DATABASE_URL = 'postgres://test';
            process.env.DISCORD_TOKEN = 'test-token';
            process.env.DISCORD_CLIENT_ID = 'test-client-id';
            process.env.GUILD_ID = 'test-guild-id';
        });

        it('validates prerequisites before proceeding', async () => {
            const prisma = makePrismaMock();
            prisma.ticket.count
                .mockResolvedValueOnce(100)
                .mockResolvedValueOnce(80)
                .mockResolvedValueOnce(20);

            const log = await executeCutover(prisma as never, {
                confirm: false,
                skipQualityCheck: true,
                announcement: 'Test',
            });

            expect(log.outcome).toBe('SUCCESS');
            expect(log.steps.length).toBeGreaterThanOrEqual(4);
        });

        it('aborts on health check failure', async () => {
            const prisma = makePrismaMock();
            prisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));

            const log = await executeCutover(prisma as never, {
                confirm: false,
                skipQualityCheck: true,
                announcement: 'Test',
            });

            expect(log.outcome).toBe('FAILED');
            expect(log.steps[0].status).toBe('FAIL');
        });
    });
});

describe('rollback', () => {
    describe('executeRollback', () => {
        it('completes successfully in dry-run mode', async () => {
            const prisma = makePrismaMock();

            const log = await executeRollback(prisma as never, {
                confirm: false,
                reason: 'Test rollback',
            });

            expect(log.outcome).toBe('SUCCESS');
            expect(log.confirm).toBe(false);
            // All steps should be SKIP or DONE
            for (const step of log.steps) {
                expect(['DONE', 'SKIP']).toContain(step.status);
            }
        });

        it('completes successfully in confirm mode', async () => {
            const prisma = makePrismaMock();

            const log = await executeRollback(prisma as never, {
                confirm: true,
                reason: 'Response quality issue',
            });

            expect(log.outcome).toBe('SUCCESS');
            expect(log.confirm).toBe(true);
        });

        it('fails if database integrity check fails', async () => {
            const prisma = makePrismaMock();
            prisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));

            const log = await executeRollback(prisma as never, {
                confirm: true,
                reason: 'Emergency',
            });

            expect(log.outcome).toBe('FAILED');
            expect(log.steps[0].status).toBe('FAIL');
        });

        it('preserves ticket data during rollback', async () => {
            const prisma = makePrismaMock();
            prisma.ticket.count.mockResolvedValue(200);

            const log = await executeRollback(prisma as never, {
                confirm: true,
                reason: 'Test',
            });

            expect(log.outcome).toBe('SUCCESS');
            // Database integrity step should report ticket count
            const dbStep = log.steps.find(s => s.step === 'Verify database integrity');
            expect(dbStep?.message).toContain('200');
        });
    });
});
