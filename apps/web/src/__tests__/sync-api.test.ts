import { describe, it, expect } from 'vitest';
import {
    MOCK_SYNC_EVENTS,
    MOCK_SYSTEM_STATUS,
    MOCK_MAPPING_CONFIG,
    filterSyncEvents,
    getUnresolvedConflicts,
    getSyncHealthColor,
} from '@/lib/mock-sync';

describe('Sync Status API data', () => {
    it('returns system status with correct shape', () => {
        expect(MOCK_SYSTEM_STATUS).toBeInstanceOf(Array);
        expect(MOCK_SYSTEM_STATUS.length).toBeGreaterThan(0);

        for (const sys of MOCK_SYSTEM_STATUS) {
            expect(sys).toHaveProperty('plugin');
            expect(sys).toHaveProperty('lastSuccessfulSync');
            expect(sys).toHaveProperty('pendingCount');
            expect(sys).toHaveProperty('failedCount');
            expect(sys).toHaveProperty('p50LatencyMs');
            expect(sys).toHaveProperty('p95LatencyMs');
            expect(typeof sys.plugin).toBe('string');
            expect(typeof sys.p50LatencyMs).toBe('number');
            expect(typeof sys.p95LatencyMs).toBe('number');
        }
    });

    it('includes github and linear systems', () => {
        const plugins = MOCK_SYSTEM_STATUS.map((s) => s.plugin);
        expect(plugins).toContain('github');
        expect(plugins).toContain('linear');
    });
});

describe('Sync Events filtering', () => {
    it('returns all events when no filters applied', () => {
        const result = filterSyncEvents({});
        expect(result).toHaveLength(MOCK_SYNC_EVENTS.length);
    });

    it('filters by sourcePlugin', () => {
        const result = filterSyncEvents({ sourcePlugin: 'github' });
        expect(result.length).toBeGreaterThan(0);
        expect(result.every((e) => e.sourcePlugin === 'github')).toBe(true);
    });

    it('filters by status', () => {
        const result = filterSyncEvents({ status: 'failed' });
        expect(result.length).toBeGreaterThan(0);
        expect(result.every((e) => e.status === 'failed')).toBe(true);
    });

    it('returns events sorted by date descending', () => {
        const result = filterSyncEvents({});
        for (let i = 1; i < result.length; i++) {
            const a = new Date(result[i - 1].createdAt).getTime();
            const b = new Date(result[i].createdAt).getTime();
            expect(a).toBeGreaterThanOrEqual(b);
        }
    });

    it('each event has required fields', () => {
        for (const event of MOCK_SYNC_EVENTS) {
            expect(event).toHaveProperty('id');
            expect(event).toHaveProperty('sourcePlugin');
            expect(event).toHaveProperty('targetPlugin');
            expect(event).toHaveProperty('ticketId');
            expect(event).toHaveProperty('action');
            expect(event).toHaveProperty('status');
            expect(event).toHaveProperty('createdAt');
        }
    });
});

describe('Conflicts', () => {
    it('returns only unresolved conflicts', () => {
        const conflicts = getUnresolvedConflicts();
        expect(conflicts.length).toBeGreaterThan(0);
        for (const c of conflicts) {
            expect(c.status).toBe('conflict');
            expect(c.resolvedAt).toBeUndefined();
        }
    });

    it('conflicts have conflict-specific fields', () => {
        const conflicts = getUnresolvedConflicts();
        for (const c of conflicts) {
            expect(c.conflictField).toBeDefined();
            expect(c.sourceValue).toBeDefined();
            expect(c.targetValue).toBeDefined();
        }
    });
});

describe('getSyncHealthColor', () => {
    it('returns green for sync less than 5 minutes ago', () => {
        const recent = new Date(Date.now() - 2 * 60_000).toISOString();
        expect(getSyncHealthColor(recent)).toBe('green');
    });

    it('returns yellow for sync between 5 and 30 minutes ago', () => {
        const medium = new Date(Date.now() - 15 * 60_000).toISOString();
        expect(getSyncHealthColor(medium)).toBe('yellow');
    });

    it('returns red for sync more than 30 minutes ago', () => {
        const old = new Date(Date.now() - 60 * 60_000).toISOString();
        expect(getSyncHealthColor(old)).toBe('red');
    });

    it('returns green for sync exactly now', () => {
        expect(getSyncHealthColor(new Date().toISOString())).toBe('green');
    });
});

describe('Mapping config shape', () => {
    it('has statusMappings for linear and github', () => {
        expect(MOCK_MAPPING_CONFIG.statusMappings).toHaveProperty('linear');
        expect(MOCK_MAPPING_CONFIG.statusMappings).toHaveProperty('github');
        expect(MOCK_MAPPING_CONFIG.statusMappings.linear.length).toBeGreaterThan(0);
        expect(MOCK_MAPPING_CONFIG.statusMappings.github.length).toBeGreaterThan(0);
    });

    it('has priorityMappings for linear and github', () => {
        expect(MOCK_MAPPING_CONFIG.priorityMappings).toHaveProperty('linear');
        expect(MOCK_MAPPING_CONFIG.priorityMappings).toHaveProperty('github');
    });

    it('has identity mappings with correct shape', () => {
        expect(MOCK_MAPPING_CONFIG.identityMappings.length).toBeGreaterThan(0);
        for (const mapping of MOCK_MAPPING_CONFIG.identityMappings) {
            expect(mapping).toHaveProperty('id');
            expect(mapping).toHaveProperty('externalPlugin');
            expect(mapping).toHaveProperty('externalUserId');
            expect(mapping).toHaveProperty('externalDisplayName');
        }
    });

    it('has label rules for github and linear', () => {
        expect(MOCK_MAPPING_CONFIG.labelRules).toHaveProperty('github');
        expect(MOCK_MAPPING_CONFIG.labelRules).toHaveProperty('linear');
    });

    it('status mapping entries have correct shape', () => {
        for (const entries of Object.values(MOCK_MAPPING_CONFIG.statusMappings)) {
            for (const entry of entries) {
                expect(entry).toHaveProperty('externalStatus');
                expect(entry).toHaveProperty('outpostStatus');
                expect(typeof entry.externalStatus).toBe('string');
                expect(typeof entry.outpostStatus).toBe('string');
            }
        }
    });
});
