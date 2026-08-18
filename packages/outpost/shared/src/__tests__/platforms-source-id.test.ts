import { describe, it, expect } from 'vitest';
import { buildTicketSourceId } from '../platforms/source-id.js';
import { TicketSource } from '../types.js';

describe('buildTicketSourceId', () => {
    it('returns the threadId verbatim for non-Slack sources', () => {
        expect(buildTicketSourceId(TicketSource.DISCORD, 'thread-123', 'channel-1')).toBe('thread-123');
        expect(buildTicketSourceId(TicketSource.TEAMS, 'conv-abc')).toBe('conv-abc');
        expect(buildTicketSourceId(TicketSource.GITHUB_ISSUE, 'owner/repo#42')).toBe('owner/repo#42');
    });

    it('builds the composite channelId:threadId key for Slack', () => {
        expect(buildTicketSourceId(TicketSource.SLACK, '1234567890.123456', 'C0ABCDEF1')).toBe(
            'C0ABCDEF1:1234567890.123456',
        );
    });

    // The whole point of the helper: no input may produce a key that only one
    // of the two call sites would ever build.
    it('returns null rather than a placeholder when there is no threadId', () => {
        expect(buildTicketSourceId(TicketSource.DISCORD, undefined, 'channel-1')).toBeNull();
        expect(buildTicketSourceId(TicketSource.DISCORD, '', 'channel-1')).toBeNull();
        expect(buildTicketSourceId(TicketSource.DISCORD, null)).toBeNull();
        // Never the empty-string key the old lookup searched for.
        expect(buildTicketSourceId(TicketSource.DISCORD, '')).not.toBe('');
    });

    it('returns null for Slack when the channelId is missing', () => {
        // A Slack thread_ts is only unique within a channel, and posting the
        // reply needs the channel anyway — a bare ts is not a usable key.
        expect(buildTicketSourceId(TicketSource.SLACK, '1234567890.123456')).toBeNull();
        expect(buildTicketSourceId(TicketSource.SLACK, '1234567890.123456', '')).toBeNull();
    });

    it('never emits the unmatchable "channel:" or "channel:undefined" Slack keys', () => {
        expect(buildTicketSourceId(TicketSource.SLACK, '', 'C123')).toBeNull();
        expect(buildTicketSourceId(TicketSource.SLACK, undefined, 'C123')).toBeNull();
    });

    it('is deterministic — the same inputs always give the writer and reader the same key', () => {
        const cases: Array<[TicketSource, string | undefined, string | undefined]> = [
            [TicketSource.SLACK, '111.222', 'C1'],
            [TicketSource.SLACK, '111.222', undefined],
            [TicketSource.DISCORD, 'thread-9', 'C1'],
            [TicketSource.DISCORD, undefined, 'C1'],
            [TicketSource.EMAIL, 'msg-1@postmark', undefined],
        ];

        for (const [source, threadId, channelId] of cases) {
            expect(buildTicketSourceId(source, threadId, channelId)).toBe(
                buildTicketSourceId(source, threadId, channelId),
            );
        }
    });
});
