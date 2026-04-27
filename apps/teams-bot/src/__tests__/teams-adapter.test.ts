import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TeamsAdapter } from '@copilotkit/outpost/shared/platforms';
import { TicketSource } from '@copilotkit/outpost/shared';
import type { TeamsActivity, FormattedResponse } from '@copilotkit/outpost/shared';

const CONFIG = {
    appId: 'test-app-id',
    appPassword: 'test-app-secret',
    tenantId: 'test-tenant-id',
};

function makeActivity(overrides: Partial<TeamsActivity> = {}): TeamsActivity {
    return {
        type: 'message',
        text: 'Hello, I need help',
        from: {
            id: 'user-1',
            name: 'Alice',
            aadObjectId: 'aad-user-1',
        },
        recipient: {
            id: 'bot-1',
            name: 'Support Bot',
        },
        conversation: {
            id: 'conv-abc',
            tenantId: 'tenant-xyz',
        },
        channelData: {
            teamsChannelId: 'channel-42',
        },
        serviceUrl: 'https://smba.trafficmanager.net/teams/',
        replyToId: undefined,
        ...overrides,
    };
}

function makeTicket(overrides: Record<string, unknown> = {}): {
    id: string;
    sourceId: string | null;
    channel: string | null;
    source: TicketSource;
} {
    return {
        id: 'ticket-1',
        sourceId: 'conv-abc',
        channel: null,
        source: TicketSource.TEAMS,
        ...overrides,
    };
}

describe('TeamsAdapter', () => {
    let adapter: TeamsAdapter;

    beforeEach(() => {
        adapter = new TeamsAdapter(CONFIG);
    });

    describe('parseInboundEvent', () => {
        it('returns an InboundMessage for a valid message activity', () => {
            const result = adapter.parseInboundEvent(makeActivity());

            expect(result).not.toBeNull();
            expect(result.source).toBe(TicketSource.TEAMS);
            expect(result.threadId).toBe('conv-abc');
            expect(result.channelId).toBe('channel-42');
            expect(result.content).toBe('Hello, I need help');
            expect(result.platformUsername).toBe('Alice');
            expect(result.platformUserId).toBe('aad-user-1');
            expect(result.isThreadStart).toBe(true);
        });

        it('marks messages with replyToId as non-thread-start', () => {
            const result = adapter.parseInboundEvent(
                makeActivity({ replyToId: 'some-message-id' }),
            );
            expect(result).not.toBeNull();
            expect(result.isThreadStart).toBe(false);
        });

        it('uses from.id when aadObjectId is missing', () => {
            const result = adapter.parseInboundEvent(
                makeActivity({
                    from: { id: 'fallback-id', name: 'Bob' },
                }),
            );
            expect(result).not.toBeNull();
            expect(result.platformUserId).toBe('fallback-id');
        });

        it('defaults platformUsername to Unknown when name is missing', () => {
            const result = adapter.parseInboundEvent(
                makeActivity({
                    from: { id: 'user-1' },
                }),
            );
            expect(result).not.toBeNull();
            expect(result.platformUsername).toBe('Unknown');
        });

        it('defaults content to empty string when text is missing', () => {
            const result = adapter.parseInboundEvent(
                makeActivity({ text: undefined }),
            );
            expect(result).not.toBeNull();
            expect(result.content).toBe('');
        });

        it('builds sourceUrl with tenant ID from config', () => {
            const result = adapter.parseInboundEvent(makeActivity());
            expect(result.sourceUrl).toBe(
                'https://teams.microsoft.com/l/message/conv-abc?tenantId=test-tenant-id',
            );
        });

        it('uses conversation tenantId when config tenantId is empty', () => {
            const noTenantAdapter = new TeamsAdapter({
                ...CONFIG,
                tenantId: undefined,
            });
            const result = noTenantAdapter.parseInboundEvent(makeActivity());
            expect(result.sourceUrl).toBe(
                'https://teams.microsoft.com/l/message/conv-abc?tenantId=tenant-xyz',
            );
        });
    });

    describe('postResponse', () => {
        let fetchSpy: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            fetchSpy = vi.fn();
            vi.stubGlobal('fetch', fetchSpy);
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        const ticket = makeTicket();

        const response: FormattedResponse = {
            text: 'Here is the answer to your question.',
        };

        it('sends proactive message with Adaptive Card via Bot Framework REST API', async () => {
            // Mock token request
            fetchSpy
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ access_token: 'test-token' }),
                })
                // Mock send message request
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ id: 'msg-1' }),
                });

            await adapter.postResponse(ticket, response);

            // First call: token request
            expect(fetchSpy).toHaveBeenCalledTimes(2);
            const tokenCall = fetchSpy.mock.calls[0];
            expect(tokenCall[0]).toContain('login.microsoftonline.com');

            // Second call: send message
            const messageCall = fetchSpy.mock.calls[1];
            expect(messageCall[0]).toContain('v3/conversations/conv-abc/activities');
            const messageOpts = messageCall[1];
            expect(messageOpts.headers.Authorization).toBe('Bearer test-token');

            const body = JSON.parse(messageOpts.body);
            expect(body.type).toBe('message');
            expect(body.attachments).toHaveLength(1);
            expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
        });

        it('throws when ticket has no sourceId', async () => {
            const ticketNoSource = makeTicket({ sourceId: null });
            await expect(
                adapter.postResponse(ticketNoSource, response),
            ).rejects.toThrow('no sourceId');
        });

        it('throws on token request failure', async () => {
            fetchSpy.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
            });

            await expect(adapter.postResponse(ticket, response)).rejects.toThrow(
                'Failed to obtain bot token',
            );
            // Only the token call should be made (message call skipped)
            expect(fetchSpy).toHaveBeenCalledTimes(1);
        });

        it('throws on message send failure', async () => {
            fetchSpy
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ access_token: 'test-token' }),
                })
                .mockResolvedValueOnce({
                    ok: false,
                    status: 403,
                    statusText: 'Forbidden',
                    text: async () => 'Bot not authorized',
                });

            await expect(adapter.postResponse(ticket, response)).rejects.toThrow(
                'Failed to send message',
            );
        });
    });

    describe('postSystemMessage', () => {
        let fetchSpy: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            fetchSpy = vi.fn();
            vi.stubGlobal('fetch', fetchSpy);
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it('sends a plain text message via Bot Framework REST API', async () => {
            const ticket = makeTicket();

            fetchSpy
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ access_token: 'test-token' }),
                })
                .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

            await adapter.postSystemMessage(ticket, 'Ticket has been escalated.');

            expect(fetchSpy).toHaveBeenCalledTimes(2);
            const messageBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
            expect(messageBody.type).toBe('message');
            expect(messageBody.text).toBe('Ticket has been escalated.');
            expect(messageBody.attachments).toBeUndefined();
        });

        it('throws when ticket has no sourceId', async () => {
            const ticketNoSource = makeTicket({ sourceId: null });
            await expect(
                adapter.postSystemMessage(ticketNoSource, 'test'),
            ).rejects.toThrow('no sourceId');
        });
    });
});
