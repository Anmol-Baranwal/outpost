/**
 * Tests for ConflictDetector — detects and resolves concurrent
 * modifications from different sync sources.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictDetector, type ConflictDetectorDeps } from '../sync/conflict.js';

// ─── Mock Factory ─────────────────────────────────────────────────────────

function makeMockDeps(): ConflictDetectorDeps {
    return {
        prisma: {
            syncEvent: {
                findFirst: vi.fn().mockResolvedValue(null),
                create: vi.fn().mockResolvedValue({ id: 'conflict-se-1' }),
            },
        },
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ConflictDetector', () => {
    let deps: ConflictDetectorDeps;
    let detector: ConflictDetector;

    beforeEach(() => {
        deps = makeMockDeps();
        detector = new ConflictDetector(deps, 60_000);
    });

    describe('detectConflict', () => {
        it('returns null when no conflicting SyncEvent exists', async () => {
            vi.mocked(deps.prisma.syncEvent.findFirst).mockResolvedValue(null);

            const result = await detector.detectConflict('linear', 'tkt-1', 'status_change');

            expect(result).toBeNull();
        });

        it('detects conflict when same entity+action was modified from a different source', async () => {
            vi.mocked(deps.prisma.syncEvent.findFirst).mockResolvedValue({
                id: 'se-github',
                sourcePlugin: 'github',
                targetPlugin: 'outpost',
                action: 'status_change',
                payloadHash: 'abc123',
                createdAt: new Date(),
            });

            const result = await detector.detectConflict('linear', 'tkt-1', 'status_change');

            expect(result).not.toBeNull();
            expect(result!.field).toBe('status_change');
            expect(result!.conflictingSource).toBe('github');
            expect(result!.winningSource).toBe('outpost');
            expect(result!.syncEventId).toBe('conflict-se-1');
        });

        it('logs the conflict as a SyncEvent with status=conflict', async () => {
            vi.mocked(deps.prisma.syncEvent.findFirst).mockResolvedValue({
                id: 'se-github',
                sourcePlugin: 'github',
                targetPlugin: 'outpost',
                action: 'status_change',
                payloadHash: 'abc123',
                createdAt: new Date(),
            });

            await detector.detectConflict('linear', 'tkt-1', 'status_change');

            expect(deps.prisma.syncEvent.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    sourcePlugin: 'linear',
                    targetPlugin: 'github',
                    entityType: 'ticket',
                    entityId: 'tkt-1',
                    action: 'status_change',
                    status: 'conflict',
                    error: expect.stringContaining('Conflict'),
                }),
            });
        });

        it('queries for events from a DIFFERENT source', async () => {
            await detector.detectConflict('linear', 'tkt-1', 'status_change');

            expect(deps.prisma.syncEvent.findFirst).toHaveBeenCalledWith({
                where: {
                    entityId: 'tkt-1',
                    action: 'status_change',
                    sourcePlugin: { not: 'linear' },
                    createdAt: { gte: expect.any(Date) },
                    status: { not: 'conflict' },
                },
                orderBy: { createdAt: 'desc' },
            });
        });

        it('does not detect conflict with itself', async () => {
            // The query should filter out events from the same source
            vi.mocked(deps.prisma.syncEvent.findFirst).mockResolvedValue(null);

            const result = await detector.detectConflict('linear', 'tkt-1', 'status_change');

            expect(result).toBeNull();
        });

        it('respects the conflict window', async () => {
            const shortDetector = new ConflictDetector(deps, 10_000);
            await shortDetector.detectConflict('linear', 'tkt-1', 'comment');

            const callArgs = vi.mocked(deps.prisma.syncEvent.findFirst).mock.calls[0][0];
            const cutoff = (callArgs.where.createdAt as { gte: Date }).gte;
            const now = Date.now();

            expect(now - cutoff.getTime()).toBeLessThan(11_000);
            expect(now - cutoff.getTime()).toBeGreaterThan(9_000);
        });
    });

    describe('resolveConflict', () => {
        it('returns the Outpost value (Outpost wins strategy)', () => {
            const result = detector.resolveConflict('RESOLVED', 'OPEN');
            expect(result).toBe('RESOLVED');
        });

        it('works with complex objects', () => {
            const outpostValue = { status: 'RESOLVED', priority: 'HIGH' };
            const externalValue = { status: 'OPEN', priority: 'LOW' };
            const result = detector.resolveConflict(outpostValue, externalValue);
            expect(result).toEqual({ status: 'RESOLVED', priority: 'HIGH' });
        });

        it('returns Outpost value even when external value seems more recent', () => {
            // The resolution strategy is always "Outpost wins"
            const result = detector.resolveConflict('old-outpost-value', 'newer-external-value');
            expect(result).toBe('old-outpost-value');
        });
    });
});
