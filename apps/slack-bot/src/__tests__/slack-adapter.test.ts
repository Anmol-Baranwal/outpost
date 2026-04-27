import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @slack/web-api before importing SlackAdapter.
// vi.hoisted runs before vi.mock factories are evaluated.
const { mockPostMessage, MockWebClient } = vi.hoisted(() => {
    const mockPostMessage = vi.fn().mockResolvedValue({ ok: true });
    class MockWebClient {
        chat = { postMessage: mockPostMessage };
        users = {
            info: vi.fn().mockResolvedValue({
                user: { name: 'testuser', profile: { display_name: 'Test User', email: 'test@example.com' } },
            }),
        };
    }
    return { mockPostMessage, MockWebClient };
});

vi.mock('@slack/web-api', () => ({
    WebClient: MockWebClient,
}));

vi.mock('@copilotkit/outpost/shared/platforms', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('@copilotkit/outpost/shared/platforms');
    return actual;
});

import { SlackAdapter, buildPermalink } from '@copilotkit/outpost/shared/platforms';
import type { SlackMessageEvent } from '@copilotkit/outpost/shared';
import { TicketSource } from '@copilotkit/outpost/shared';

function makeAdapter() {
    return new SlackAdapter({
        token: 'xoxb-test-token',
    });
}

describe('SlackAdapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('parseInboundEvent', () => {
        it('parses a new top-level message into an InboundMessage', () => {
            const adapter = makeAdapter();
            const event: SlackMessageEvent = {
                user: 'U_EXTERNAL',
                text: 'Help with CopilotKit',
                ts: '1234567890.123456',
                channel: 'C_MONITORED',
            };

            const result = adapter.parseInboundEvent(event);

            expect(result.platformUserId).toBe('U_EXTERNAL');
            expect(result.platformUsername).toBe('slack:U_EXTERNAL');
            expect(result.content).toBe('Help with CopilotKit');
            expect(result.channelId).toBe('C_MONITORED');
            expect(result.source).toBe(TicketSource.SLACK);
            expect(result.isThreadStart).toBe(true);
            expect(result.sourceUrl).toContain('slack.com/archives/C_MONITORED/p');
        });

        it('parses a threaded reply', () => {
            const adapter = makeAdapter();
            const event: SlackMessageEvent = {
                user: 'U_EXTERNAL',
                text: 'More info',
                ts: '1234567891.000000',
                thread_ts: '1234567890.123456',
                channel: 'C_MONITORED',
            };

            const result = adapter.parseInboundEvent(event);

            expect(result.threadId).toBe('1234567890.123456');
            expect(result.isThreadStart).toBe(false);
        });

        it('treats thread_ts === ts as a top-level message (not a reply)', () => {
            const adapter = makeAdapter();
            const event: SlackMessageEvent = {
                user: 'U_EXTERNAL',
                text: 'Thread parent',
                ts: '1234567890.123456',
                thread_ts: '1234567890.123456',
                channel: 'C_MONITORED',
            };

            const result = adapter.parseInboundEvent(event);

            expect(result.isThreadStart).toBe(true);
        });
    });

    describe('postResponse', () => {
        it('posts a message with Block Kit blocks', async () => {
            const adapter = makeAdapter();

            const ticket = {
                id: 'ticket-1',
                sourceId: 'C_CHAN:123.456',
                channel: 'C_CHAN',
                source: TicketSource.SLACK,
            };

            await adapter.postResponse(ticket, {
                text: 'Here is the answer.',
            });

            expect(mockPostMessage).toHaveBeenCalledWith({
                channel: 'C_CHAN',
                thread_ts: '123.456',
                text: 'Here is the answer.',
                blocks: expect.arrayContaining([
                    expect.objectContaining({ type: 'section' }),
                ]),
            });
        });

        it('throws when ticket is missing sourceId or channel', async () => {
            const adapter = makeAdapter();

            await expect(
                adapter.postResponse(
                    { id: 'ticket-1', sourceId: null, channel: 'C_CHAN', source: TicketSource.SLACK },
                    { text: 'Response' },
                ),
            ).rejects.toThrow('missing sourceId or channel');

            await expect(
                adapter.postResponse(
                    { id: 'ticket-1', sourceId: 'C_CHAN:ts', channel: null, source: TicketSource.SLACK },
                    { text: 'Response' },
                ),
            ).rejects.toThrow('missing sourceId or channel');
        });
    });

    describe('postSystemMessage', () => {
        it('posts a plain text message in a thread', async () => {
            const adapter = makeAdapter();

            const ticket = {
                id: 'ticket-1',
                sourceId: 'C_CHAN:123.456',
                channel: 'C_CHAN',
                source: TicketSource.SLACK,
            };

            await adapter.postSystemMessage(ticket, 'Ticket created.');

            expect(mockPostMessage).toHaveBeenCalledWith({
                channel: 'C_CHAN',
                thread_ts: '123.456',
                text: 'Ticket created.',
            });
        });
    });

    describe('buildPermalink', () => {
        it('builds a valid Slack permalink URL', () => {
            const url = buildPermalink('C12345', '1234567890.123456');
            expect(url).toBe('https://slack.com/archives/C12345/p1234567890123456');
        });

        it('handles timestamps without dots', () => {
            const url = buildPermalink('C12345', '1234567890123456');
            expect(url).toBe('https://slack.com/archives/C12345/p1234567890123456');
        });
    });
});
