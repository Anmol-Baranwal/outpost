import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTicketFindUnique = vi.fn();
const mockMessageFindUnique = vi.fn();
const mockLinkFindUnique = vi.fn();
const mockLinkCreate = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        ticket: { findUnique: (...a: unknown[]) => mockTicketFindUnique(...a) },
        message: { findUnique: (...a: unknown[]) => mockMessageFindUnique(...a) },
        ticketExternalLink: {
            findUnique: (...a: unknown[]) => mockLinkFindUnique(...a),
            create: (...a: unknown[]) => mockLinkCreate(...a),
        },
    },
}));

import { handleSlackMirror, SLACK_MIRROR_PLUGIN } from '../slack-mirror.js';
import { readSlackMirrorConfig, isSlackMirrorEnabled } from '@copilotkit/outpost/shared/platforms';
import type { SlackMirrorConfig } from '@copilotkit/outpost/shared/platforms';

const context = { reportProgress: vi.fn().mockResolvedValue(undefined), jobId: 'job-1' };

const TICKET = {
    id: 'tkt-1',
    displayId: 'OUT-101',
    title: 'Sidebar crashes on mount',
    description: 'Repro: render CopilotSidebar with no props.',
    source: 'GITHUB',
    sourceUrl: 'https://github.com/CopilotKit/CopilotKit/issues/42',
};

const liveConfig: SlackMirrorConfig = { mode: 'live', channelId: 'C0MIRROR', token: 'xoxb-1' };

function makePoster(ts = '1712345678.000100') {
    const postMessage = vi.fn().mockResolvedValue({ ts });
    return { poster: { postMessage }, postMessage };
}

describe('readSlackMirrorConfig', () => {
    it('defaults to off when the mode is unset', () => {
        expect(readSlackMirrorConfig({}).mode).toBe('off');
    });

    it('fails closed on an unrecognized mode rather than posting', () => {
        expect(readSlackMirrorConfig({ SLACK_MIRROR_MODE: 'on' }).mode).toBe('off');
        expect(readSlackMirrorConfig({ SLACK_MIRROR_MODE: 'LIVE' }).mode).toBe('live');
    });

    it('treats a blank channel ID as unset', () => {
        expect(readSlackMirrorConfig({ SLACK_MIRROR_CHANNEL_ID: '   ' }).channelId).toBeNull();
    });
});

describe('isSlackMirrorEnabled', () => {
    it('is disabled when off, even with a channel configured', () => {
        expect(isSlackMirrorEnabled({ mode: 'off', channelId: 'C1', token: 'x' })).toBe(false);
    });

    it('is disabled when live but no channel is configured', () => {
        expect(isSlackMirrorEnabled({ mode: 'live', channelId: null, token: 'x' })).toBe(false);
    });

    it('is enabled in shadow without a token, since shadow never posts', () => {
        expect(isSlackMirrorEnabled({ mode: 'shadow', channelId: 'C1', token: null })).toBe(true);
    });
});

describe('handleSlackMirror', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTicketFindUnique.mockResolvedValue(TICKET);
        mockLinkFindUnique.mockResolvedValue(null);
        mockLinkCreate.mockResolvedValue({});
    });

    it('posts nothing and touches no DB when the mirror is off', async () => {
        const { poster, postMessage } = makePoster();
        const result = await handleSlackMirror({ ticketId: 'tkt-1', kind: 'ticket' }, context, {
            config: { mode: 'off', channelId: 'C0MIRROR', token: 'xoxb-1' },
            poster,
        });

        expect(result).toEqual({ success: true, data: { skipped: 'mirror-disabled' } });
        expect(postMessage).not.toHaveBeenCalled();
        expect(mockTicketFindUnique).not.toHaveBeenCalled();
    });

    it('opens a thread and records the link under plugin slack', async () => {
        const { poster, postMessage } = makePoster('1712345678.000100');

        const result = await handleSlackMirror({ ticketId: 'tkt-1', kind: 'ticket' }, context, {
            config: liveConfig,
            poster,
        });

        expect(result.success).toBe(true);
        expect(postMessage).toHaveBeenCalledTimes(1);
        const posted = postMessage.mock.calls[0][0];
        expect(posted.channel).toBe('C0MIRROR');
        expect(posted.thread_ts).toBeUndefined();
        expect(posted.text).toContain('OUT-101');
        expect(posted.text).toContain('Sidebar crashes on mount');
        expect(posted.text).toContain('https://github.com/CopilotKit/CopilotKit/issues/42');

        expect(mockLinkCreate).toHaveBeenCalledTimes(1);
        expect(mockLinkCreate.mock.calls[0][0].data).toMatchObject({
            ticketId: 'tkt-1',
            plugin: SLACK_MIRROR_PLUGIN,
            externalId: 'C0MIRROR:1712345678.000100',
        });
    });

    it('does not open a second thread for an already-mirrored ticket', async () => {
        mockLinkFindUnique.mockResolvedValue({ externalId: 'C0MIRROR:111.222' });
        const { poster, postMessage } = makePoster();

        const result = await handleSlackMirror({ ticketId: 'tkt-1', kind: 'ticket' }, context, {
            config: liveConfig,
            poster,
        });

        expect(result).toEqual({ success: true, data: { skipped: 'already-mirrored' } });
        expect(postMessage).not.toHaveBeenCalled();
        expect(mockLinkCreate).not.toHaveBeenCalled();
    });

    it('threads a reply under the existing ticket thread', async () => {
        mockLinkFindUnique.mockResolvedValue({ externalId: 'C0MIRROR:111.222' });
        mockMessageFindUnique.mockResolvedValue({
            id: 'msg-9',
            author: 'octocat (12345)',
            content: 'Still broken on 1.10.2',
            isAiGenerated: false,
        });
        const { poster, postMessage } = makePoster();

        const result = await handleSlackMirror(
            { ticketId: 'tkt-1', kind: 'reply', messageId: 'msg-9' },
            context,
            { config: liveConfig, poster },
        );

        expect(result.success).toBe(true);
        expect(postMessage).toHaveBeenCalledTimes(1);
        const posted = postMessage.mock.calls[0][0];
        expect(posted.thread_ts).toBe('111.222');
        expect(posted.text).toContain('Still broken on 1.10.2');
        expect(mockLinkCreate).not.toHaveBeenCalled();
    });

    it('opens the thread first when a reply arrives with no thread yet', async () => {
        mockLinkFindUnique.mockResolvedValue(null);
        mockMessageFindUnique.mockResolvedValue({
            id: 'msg-9',
            author: 'octocat (12345)',
            content: 'Still broken',
            isAiGenerated: false,
        });
        const { poster, postMessage } = makePoster('999.111');

        const result = await handleSlackMirror(
            { ticketId: 'tkt-1', kind: 'reply', messageId: 'msg-9' },
            context,
            { config: liveConfig, poster },
        );

        expect(result.success).toBe(true);
        expect(postMessage).toHaveBeenCalledTimes(2);
        expect(postMessage.mock.calls[0][0].thread_ts).toBeUndefined();
        expect(postMessage.mock.calls[1][0].thread_ts).toBe('999.111');
        expect(mockLinkCreate).toHaveBeenCalledTimes(1);
    });

    it('marks an undelivered AI reply instead of implying the reporter saw it', async () => {
        mockLinkFindUnique.mockResolvedValue({ externalId: 'C0MIRROR:111.222' });
        mockMessageFindUnique.mockResolvedValue({
            id: 'msg-ai',
            author: 'outpost-ai',
            content: '## Bug Confirmed…',
            isAiGenerated: true,
        });
        const { poster, postMessage } = makePoster();

        await handleSlackMirror(
            { ticketId: 'tkt-1', kind: 'reply', messageId: 'msg-ai', delivered: false },
            context,
            { config: liveConfig, poster },
        );

        expect(postMessage.mock.calls[0][0].text).toContain('not delivered to the reporter');
    });

    it('does not mark a delivered AI reply', async () => {
        mockLinkFindUnique.mockResolvedValue({ externalId: 'C0MIRROR:111.222' });
        mockMessageFindUnique.mockResolvedValue({
            id: 'msg-ai',
            author: 'outpost-ai',
            content: 'Here is the fix',
            isAiGenerated: true,
        });
        const { poster, postMessage } = makePoster();

        await handleSlackMirror(
            { ticketId: 'tkt-1', kind: 'reply', messageId: 'msg-ai', delivered: true },
            context,
            { config: liveConfig, poster },
        );

        expect(postMessage.mock.calls[0][0].text).not.toContain('not delivered');
    });

    it('shadow mode posts nothing and records no link', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { poster, postMessage } = makePoster();

        const result = await handleSlackMirror({ ticketId: 'tkt-1', kind: 'ticket' }, context, {
            config: { mode: 'shadow', channelId: 'C0MIRROR', token: null },
            poster,
        });

        expect(result.success).toBe(true);
        expect(postMessage).not.toHaveBeenCalled();
        expect(mockLinkCreate).not.toHaveBeenCalled();
        expect(logSpy.mock.calls.flat().join(' ')).toContain('would open thread');
        logSpy.mockRestore();
    });

    it('fails the job when the ticket is gone', async () => {
        mockTicketFindUnique.mockResolvedValue(null);
        const { poster } = makePoster();

        const result = await handleSlackMirror({ ticketId: 'missing', kind: 'ticket' }, context, {
            config: liveConfig,
            poster,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('missing');
    });

    it('fails a reply job that carries no messageId', async () => {
        mockLinkFindUnique.mockResolvedValue({ externalId: 'C0MIRROR:111.222' });
        const { poster } = makePoster();

        const result = await handleSlackMirror({ ticketId: 'tkt-1', kind: 'reply' }, context, {
            config: liveConfig,
            poster,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('messageId');
    });
});
