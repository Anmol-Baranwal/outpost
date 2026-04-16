/**
 * Tests for sync mapping layer — status, priority, identity, and label mappers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TicketStatus, TicketPriority } from '../types.js';
import {
    StatusMap,
    createGitHubStatusMap,
    createLinearStatusMap,
} from '../sync/status-map.js';
import {
    PriorityMap,
    createLinearPriorityMap,
    createGitHubPriorityMap,
} from '../sync/priority-map.js';
import { IdentityMapper } from '../sync/identity-map.js';
import type { IdentityMapperDeps } from '../sync/identity-map.js';
import {
    LabelMapper,
    createGitHubLabelMapper,
    createLinearLabelMapper,
} from '../sync/label-map.js';

// ─── Status Mapping ───────────────────────────────────────────────────────

describe('StatusMap', () => {
    describe('custom config', () => {
        const map = new StatusMap({
            open: TicketStatus.OPEN,
            'in progress': TicketStatus.IN_PROGRESS,
            done: TicketStatus.RESOLVED,
            closed: TicketStatus.CLOSED,
        });

        it('maps external → outpost', () => {
            expect(map.toOutpost('open')).toBe(TicketStatus.OPEN);
            expect(map.toOutpost('in progress')).toBe(TicketStatus.IN_PROGRESS);
            expect(map.toOutpost('done')).toBe(TicketStatus.RESOLVED);
            expect(map.toOutpost('closed')).toBe(TicketStatus.CLOSED);
        });

        it('maps outpost → external (first match wins)', () => {
            expect(map.fromOutpost(TicketStatus.OPEN)).toBe('open');
            expect(map.fromOutpost(TicketStatus.IN_PROGRESS)).toBe('in progress');
            expect(map.fromOutpost(TicketStatus.RESOLVED)).toBe('done');
            expect(map.fromOutpost(TicketStatus.CLOSED)).toBe('closed');
        });

        it('is case-insensitive for external statuses', () => {
            expect(map.toOutpost('OPEN')).toBe(TicketStatus.OPEN);
            expect(map.toOutpost('In Progress')).toBe(TicketStatus.IN_PROGRESS);
            expect(map.toOutpost('DONE')).toBe(TicketStatus.RESOLVED);
        });

        it('falls back to OPEN for unknown external statuses', () => {
            expect(map.toOutpost('unknown_status')).toBe(TicketStatus.OPEN);
            expect(map.toOutpost('')).toBe(TicketStatus.OPEN);
        });

        it('falls back for unmapped Outpost statuses', () => {
            // WAITING_ON_CUSTOMER is not in the config — should return first entry
            expect(map.fromOutpost(TicketStatus.WAITING_ON_CUSTOMER)).toBe('open');
        });

        it('hasExternal reports correctly', () => {
            expect(map.hasExternal('open')).toBe(true);
            expect(map.hasExternal('OPEN')).toBe(true);
            expect(map.hasExternal('nope')).toBe(false);
        });

        it('hasOutpost reports correctly', () => {
            expect(map.hasOutpost(TicketStatus.OPEN)).toBe(true);
            expect(map.hasOutpost(TicketStatus.WAITING_ON_TEAM)).toBe(false);
        });
    });

    describe('GitHub factory', () => {
        const map = createGitHubStatusMap();

        it('maps open → OPEN', () => {
            expect(map.toOutpost('open')).toBe(TicketStatus.OPEN);
        });

        it('maps closed → CLOSED', () => {
            expect(map.toOutpost('closed')).toBe(TicketStatus.CLOSED);
        });

        it('maps OPEN → open', () => {
            expect(map.fromOutpost(TicketStatus.OPEN)).toBe('open');
        });

        it('maps CLOSED → closed', () => {
            expect(map.fromOutpost(TicketStatus.CLOSED)).toBe('closed');
        });
    });

    describe('Linear factory', () => {
        const map = createLinearStatusMap();

        it('maps all Linear statuses', () => {
            expect(map.toOutpost('Triage')).toBe(TicketStatus.OPEN);
            expect(map.toOutpost('Backlog')).toBe(TicketStatus.OPEN);
            expect(map.toOutpost('Todo')).toBe(TicketStatus.OPEN);
            expect(map.toOutpost('In Progress')).toBe(TicketStatus.IN_PROGRESS);
            expect(map.toOutpost('Done')).toBe(TicketStatus.RESOLVED);
            expect(map.toOutpost('Canceled')).toBe(TicketStatus.CLOSED);
        });

        it('reverse maps Outpost statuses (first match wins)', () => {
            // Triage is first entry mapping to OPEN
            expect(map.fromOutpost(TicketStatus.OPEN)).toBe('Triage');
            expect(map.fromOutpost(TicketStatus.IN_PROGRESS)).toBe('In Progress');
            expect(map.fromOutpost(TicketStatus.RESOLVED)).toBe('Done');
            expect(map.fromOutpost(TicketStatus.CLOSED)).toBe('Canceled');
        });
    });
});

// ─── Priority Mapping ─────────────────────────────────────────────────────

describe('PriorityMap', () => {
    describe('custom config', () => {
        const map = new PriorityMap({
            urgent: TicketPriority.CRITICAL,
            high: TicketPriority.HIGH,
            normal: TicketPriority.MEDIUM,
            low: TicketPriority.LOW,
        });

        it('maps external → outpost', () => {
            expect(map.toOutpost('urgent')).toBe(TicketPriority.CRITICAL);
            expect(map.toOutpost('high')).toBe(TicketPriority.HIGH);
            expect(map.toOutpost('normal')).toBe(TicketPriority.MEDIUM);
            expect(map.toOutpost('low')).toBe(TicketPriority.LOW);
        });

        it('maps outpost → external', () => {
            expect(map.fromOutpost(TicketPriority.CRITICAL)).toBe('urgent');
            expect(map.fromOutpost(TicketPriority.HIGH)).toBe('high');
            expect(map.fromOutpost(TicketPriority.MEDIUM)).toBe('normal');
            expect(map.fromOutpost(TicketPriority.LOW)).toBe('low');
        });

        it('is case-insensitive', () => {
            expect(map.toOutpost('URGENT')).toBe(TicketPriority.CRITICAL);
            expect(map.toOutpost('High')).toBe(TicketPriority.HIGH);
        });

        it('falls back to MEDIUM for unknown priorities', () => {
            expect(map.toOutpost('unknown')).toBe(TicketPriority.MEDIUM);
        });
    });

    describe('Linear factory', () => {
        const map = createLinearPriorityMap();

        it('maps Linear numeric priorities', () => {
            expect(map.toOutpost('0')).toBe(TicketPriority.MEDIUM);   // None
            expect(map.toOutpost('1')).toBe(TicketPriority.CRITICAL); // Urgent
            expect(map.toOutpost('2')).toBe(TicketPriority.HIGH);     // High
            expect(map.toOutpost('3')).toBe(TicketPriority.MEDIUM);   // Medium
            expect(map.toOutpost('4')).toBe(TicketPriority.LOW);      // Low
        });

        it('reverse maps outpost priorities', () => {
            expect(map.fromOutpost(TicketPriority.CRITICAL)).toBe('1');
            expect(map.fromOutpost(TicketPriority.HIGH)).toBe('2');
            // '0' is first entry for MEDIUM
            expect(map.fromOutpost(TicketPriority.MEDIUM)).toBe('0');
            expect(map.fromOutpost(TicketPriority.LOW)).toBe('4');
        });
    });

    describe('GitHub factory', () => {
        const map = createGitHubPriorityMap();

        it('maps label-based priorities', () => {
            expect(map.toOutpost('critical')).toBe(TicketPriority.CRITICAL);
            expect(map.toOutpost('high')).toBe(TicketPriority.HIGH);
            expect(map.toOutpost('medium')).toBe(TicketPriority.MEDIUM);
            expect(map.toOutpost('low')).toBe(TicketPriority.LOW);
        });
    });
});

// ─── Identity Mapping ─────────────────────────────────────────────────────

describe('IdentityMapper', () => {
    let mockPrisma: IdentityMapperDeps;
    let mapper: IdentityMapper;

    beforeEach(() => {
        mockPrisma = {
            externalIdentity: {
                findUnique: vi.fn(),
                findFirst: vi.fn().mockResolvedValue(null),
                findMany: vi.fn(),
                create: vi.fn(),
            },
        };
        mapper = new IdentityMapper(mockPrisma);
    });

    describe('resolve', () => {
        it('returns TeamMemberRef when identity exists', async () => {
            vi.mocked(mockPrisma.externalIdentity.findUnique).mockResolvedValue({
                id: 'eid-1',
                plugin: 'github',
                externalId: 'gh-user-42',
                memberId: 'member-1',
                member: {
                    id: 'member-1',
                    name: 'Alice',
                    email: 'alice@example.com',
                },
            });

            const result = await mapper.resolve('github', 'gh-user-42');

            expect(result).toEqual({
                id: 'member-1',
                name: 'Alice',
                email: 'alice@example.com',
            });
            expect(mockPrisma.externalIdentity.findUnique).toHaveBeenCalledWith({
                where: {
                    plugin_externalId: { plugin: 'github', externalId: 'gh-user-42' },
                },
                include: { member: true },
            });
        });

        it('returns null when identity does not exist', async () => {
            vi.mocked(mockPrisma.externalIdentity.findUnique).mockResolvedValue(null);

            const result = await mapper.resolve('github', 'unknown-user');

            expect(result).toBeNull();
        });
    });

    describe('register', () => {
        it('creates an ExternalIdentity row', async () => {
            vi.mocked(mockPrisma.externalIdentity.create).mockResolvedValue({
                id: 'eid-new',
                plugin: 'linear',
                externalId: 'lin-user-7',
                memberId: 'member-3',
            });

            await mapper.register('linear', 'lin-user-7', 'member-3');

            expect(mockPrisma.externalIdentity.create).toHaveBeenCalledWith({
                data: {
                    plugin: 'linear',
                    externalId: 'lin-user-7',
                    memberId: 'member-3',
                },
            });
        });
    });

    describe('bulkResolve', () => {
        it('returns a map of externalId → TeamMemberRef', async () => {
            vi.mocked(mockPrisma.externalIdentity.findMany).mockResolvedValue([
                {
                    id: 'eid-1',
                    plugin: 'github',
                    externalId: 'gh-user-1',
                    memberId: 'member-1',
                    member: { id: 'member-1', name: 'Alice', email: 'alice@example.com' },
                },
                {
                    id: 'eid-2',
                    plugin: 'github',
                    externalId: 'gh-user-2',
                    memberId: 'member-2',
                    member: { id: 'member-2', name: 'Bob', email: 'bob@example.com' },
                },
            ]);

            const result = await mapper.bulkResolve('github', ['gh-user-1', 'gh-user-2', 'gh-user-3']);

            expect(result.size).toBe(2);
            expect(result.get('gh-user-1')).toEqual({
                id: 'member-1',
                name: 'Alice',
                email: 'alice@example.com',
            });
            expect(result.get('gh-user-2')).toEqual({
                id: 'member-2',
                name: 'Bob',
                email: 'bob@example.com',
            });
            expect(result.has('gh-user-3')).toBe(false);
        });

        it('returns empty map when no identities found', async () => {
            vi.mocked(mockPrisma.externalIdentity.findMany).mockResolvedValue([]);

            const result = await mapper.bulkResolve('github', ['gh-user-999']);

            expect(result.size).toBe(0);
        });
    });
});

// ─── Label Mapping ────────────────────────────────────────────────────────

describe('LabelMapper', () => {
    describe('custom config', () => {
        const mapper = new LabelMapper({
            rules: [
                { externalPrefix: 'priority:', outpostPrefix: '' },
                { externalPrefix: 'type:', outpostPrefix: '' },
                { externalPrefix: 'area/', outpostPrefix: '' },
            ],
            exclude: ['wontfix', 'duplicate'],
        });

        it('strips known prefixes from external labels', () => {
            expect(mapper.toOutpost(['priority:high', 'type:bug', 'area/frontend'])).toEqual([
                'high',
                'bug',
                'frontend',
            ]);
        });

        it('passes through labels with no matching prefix', () => {
            expect(mapper.toOutpost(['enhancement', 'help wanted'])).toEqual([
                'enhancement',
                'help wanted',
            ]);
        });

        it('excludes blacklisted labels', () => {
            expect(mapper.toOutpost(['priority:high', 'wontfix', 'duplicate', 'good'])).toEqual([
                'high',
                'good',
            ]);
        });

        it('exclude is case-insensitive', () => {
            expect(mapper.toOutpost(['WONTFIX', 'Duplicate'])).toEqual([]);
        });

        it('prefix stripping is case-insensitive', () => {
            expect(mapper.toOutpost(['Priority:critical'])).toEqual(['critical']);
            expect(mapper.toOutpost(['TYPE:feature'])).toEqual(['feature']);
        });

        it('does not produce empty tags from prefix-only labels', () => {
            // "priority:" with nothing after → empty string → filtered out
            expect(mapper.toOutpost(['priority:'])).toEqual([]);
        });
    });

    describe('toExternal (round-trip)', () => {
        const mapper = new LabelMapper({
            rules: [
                { externalPrefix: 'priority:', outpostPrefix: '' },
                { externalPrefix: 'type:', outpostPrefix: '' },
            ],
        });

        it('adds the prefix from the specified rule index', () => {
            expect(mapper.toExternal('high', 0)).toBe('priority:high');
            expect(mapper.toExternal('bug', 1)).toBe('type:bug');
        });

        it('returns tag as-is for invalid rule index', () => {
            expect(mapper.toExternal('other', -1)).toBe('other');
            expect(mapper.toExternal('other', 99)).toBe('other');
        });
    });

    describe('GitHub factory', () => {
        const mapper = createGitHubLabelMapper();

        it('strips GitHub label prefixes', () => {
            expect(mapper.toOutpost(['priority:high', 'type:bug', 'area/backend'])).toEqual([
                'high',
                'bug',
                'backend',
            ]);
        });

        it('excludes GitHub noise labels', () => {
            expect(mapper.toOutpost(['wontfix', 'invalid', 'duplicate'])).toEqual([]);
        });
    });

    describe('Linear factory', () => {
        const mapper = createLinearLabelMapper();

        it('strips Linear label prefixes', () => {
            expect(mapper.toOutpost(['Priority: High', 'Type: Bug'])).toEqual([
                'High',
                'Bug',
            ]);
        });

        it('passes through unprefixed labels', () => {
            expect(mapper.toOutpost(['Feature', 'API'])).toEqual(['Feature', 'API']);
        });
    });
});
