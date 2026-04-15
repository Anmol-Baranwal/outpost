import { describe, it, expect } from 'vitest';
import {
    MOCK_BROADCASTS,
    filterMockBroadcasts,
    findMockBroadcast,
    MAX_BROADCAST_LENGTH,
} from '@/lib/mock-broadcasts';

describe('Broadcast API logic', () => {
    describe('filterMockBroadcasts', () => {
        it('returns all broadcasts when no filter is applied', () => {
            const result = filterMockBroadcasts({});
            expect(result).toHaveLength(MOCK_BROADCASTS.length);
        });

        it('filters by draft status', () => {
            const result = filterMockBroadcasts({ status: 'draft' });
            expect(result.every((b) => b.status === 'draft')).toBe(true);
            expect(result.length).toBeGreaterThan(0);
        });

        it('filters by sent status', () => {
            const result = filterMockBroadcasts({ status: 'sent' });
            expect(result.every((b) => b.status === 'sent')).toBe(true);
            expect(result.length).toBeGreaterThan(0);
        });

        it('returns results sorted by date descending', () => {
            const result = filterMockBroadcasts({});
            for (let i = 1; i < result.length; i++) {
                const dateA = new Date(result[i - 1].sentAt || result[i - 1].createdAt);
                const dateB = new Date(result[i].sentAt || result[i].createdAt);
                expect(dateA.getTime()).toBeGreaterThanOrEqual(dateB.getTime());
            }
        });
    });

    describe('findMockBroadcast', () => {
        it('finds a broadcast by ID', () => {
            const broadcast = findMockBroadcast('bc-1');
            expect(broadcast).toBeDefined();
            expect(broadcast?.id).toBe('bc-1');
        });

        it('returns undefined for non-existent ID', () => {
            const broadcast = findMockBroadcast('nonexistent');
            expect(broadcast).toBeUndefined();
        });
    });

    describe('MOCK_BROADCASTS data integrity', () => {
        it('has exactly 5 mock broadcasts', () => {
            expect(MOCK_BROADCASTS).toHaveLength(5);
        });

        it('has a mix of draft and sent broadcasts', () => {
            const drafts = MOCK_BROADCASTS.filter((b) => b.status === 'draft');
            const sent = MOCK_BROADCASTS.filter((b) => b.status === 'sent');
            expect(drafts.length).toBeGreaterThan(0);
            expect(sent.length).toBeGreaterThan(0);
        });

        it('all sent broadcasts have a sentAt date', () => {
            const sent = MOCK_BROADCASTS.filter((b) => b.status === 'sent');
            expect(sent.every((b) => b.sentAt !== null)).toBe(true);
        });

        it('all draft broadcasts have no sentAt date', () => {
            const drafts = MOCK_BROADCASTS.filter((b) => b.status === 'draft');
            expect(drafts.every((b) => b.sentAt === null)).toBe(true);
        });

        it('all broadcasts have valid sender references', () => {
            for (const bc of MOCK_BROADCASTS) {
                expect(bc.sender).toBeDefined();
                expect(bc.sender.id).toBe(bc.senderId);
            }
        });

        it('specific audience broadcasts have matching account references', () => {
            const specific = MOCK_BROADCASTS.filter((b) => b.audienceType === 'specific');
            for (const bc of specific) {
                expect(bc.audienceAccountIds.length).toBeGreaterThan(0);
                expect(bc.audienceAccounts.length).toBe(bc.audienceAccountIds.length);
            }
        });

        it('all broadcast messages are within character limit', () => {
            for (const bc of MOCK_BROADCASTS) {
                expect(bc.message.length).toBeLessThanOrEqual(MAX_BROADCAST_LENGTH);
            }
        });
    });
});
