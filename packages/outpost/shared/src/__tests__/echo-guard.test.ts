/**
 * Tests for EchoGuard — loop prevention layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EchoGuard, type EchoGuardDeps } from '../sync/echo-guard.js';

// ─── Mock Factory ─────────────────────────────────────────────────────────

function makeMockDeps(): EchoGuardDeps {
    return {
        prisma: {
            syncEvent: {
                findFirst: vi.fn().mockResolvedValue(null),
                create: vi.fn().mockResolvedValue({ id: 'se-1' }),
            },
        },
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('EchoGuard', () => {
    let deps: EchoGuardDeps;
    let guard: EchoGuard;

    beforeEach(() => {
        deps = makeMockDeps();
        guard = new EchoGuard(deps, 60_000);
    });

    describe('shouldSync', () => {
        it('returns true when no matching SyncEvent exists (no echo)', async () => {
            vi.mocked(deps.prisma.syncEvent.findFirst).mockResolvedValue(null);

            const result = await guard.shouldSync('linear', 'github', 'tkt-1', 'hash123');

            expect(result).toBe(true);
        });

        it('returns false when a matching reverse-direction SyncEvent exists (echo detected)', async () => {
            vi.mocked(deps.prisma.syncEvent.findFirst).mockResolvedValue({
                id: 'se-existing',
                createdAt: new Date(),
            });

            const result = await guard.shouldSync('linear', 'github', 'tkt-1', 'hash123');

            expect(result).toBe(false);
        });

        it('queries for the reverse direction (target→source)', async () => {
            await guard.shouldSync('linear', 'github', 'tkt-1', 'hash123');

            expect(deps.prisma.syncEvent.findFirst).toHaveBeenCalledWith({
                where: {
                    entityId: 'tkt-1',
                    sourcePlugin: 'github',      // reverse: target becomes source
                    targetPlugin: 'linear',       // reverse: source becomes target
                    payloadHash: 'hash123',
                    createdAt: { gte: expect.any(Date) },
                },
                orderBy: { createdAt: 'desc' },
            });
        });

        it('respects the configured echo window', async () => {
            const shortGuard = new EchoGuard(deps, 5_000);
            await shortGuard.shouldSync('linear', 'github', 'tkt-1', 'hash123');

            const callArgs = vi.mocked(deps.prisma.syncEvent.findFirst).mock.calls[0][0];
            const cutoff = (callArgs.where.createdAt as { gte: Date }).gte;
            const now = Date.now();

            // The cutoff should be roughly 5 seconds ago (within 1 second tolerance)
            expect(now - cutoff.getTime()).toBeLessThan(6_000);
            expect(now - cutoff.getTime()).toBeGreaterThan(4_000);
        });
    });

    describe('recordSync', () => {
        it('creates a success SyncEvent', async () => {
            await guard.recordSync(
                'linear', 'github', 'tkt-1', 'status_change', 'hash123', 'success',
            );

            expect(deps.prisma.syncEvent.create).toHaveBeenCalledWith({
                data: {
                    sourcePlugin: 'linear',
                    targetPlugin: 'github',
                    entityType: 'ticket',
                    entityId: 'tkt-1',
                    action: 'status_change',
                    payloadHash: 'hash123',
                    status: 'success',
                    error: null,
                },
            });
        });

        it('creates a failure SyncEvent with error message', async () => {
            await guard.recordSync(
                'linear', 'github', 'tkt-1', 'comment', 'hash456', 'failure', 'API timeout',
            );

            expect(deps.prisma.syncEvent.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    status: 'failure',
                    error: 'API timeout',
                }),
            });
        });

        it('creates a conflict SyncEvent', async () => {
            await guard.recordSync(
                'linear', 'github', 'tkt-1', 'status_change', 'hash789', 'conflict',
            );

            expect(deps.prisma.syncEvent.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    status: 'conflict',
                }),
            });
        });
    });

    describe('computeHash', () => {
        it('produces deterministic hashes for the same input', () => {
            const h1 = EchoGuard.computeHash({ entityId: 'tkt-1', action: 'status_change', status: 'OPEN' });
            const h2 = EchoGuard.computeHash({ entityId: 'tkt-1', action: 'status_change', status: 'OPEN' });
            expect(h1).toBe(h2);
        });

        it('produces different hashes for different inputs', () => {
            const h1 = EchoGuard.computeHash({ entityId: 'tkt-1', action: 'status_change', status: 'OPEN' });
            const h2 = EchoGuard.computeHash({ entityId: 'tkt-1', action: 'status_change', status: 'CLOSED' });
            expect(h1).not.toBe(h2);
        });

        it('returns a 16-character hex string', () => {
            const hash = EchoGuard.computeHash({ entityId: 'tkt-1', comment: 'hello' });
            expect(hash).toMatch(/^[0-9a-f]{16}$/);
        });
    });
});
