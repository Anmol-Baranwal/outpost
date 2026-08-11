import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPrisma, mockQueue } from './helpers/mocks.js';

// Mock @slack/web-api so SlackAdapter doesn't try real HTTP calls.
// vi.hoisted ensures the class is available when the hoisted vi.mock factory runs.
const { mockPostMessage, MockWebClient } = vi.hoisted(() => {
    const mockPostMessage = vi.fn().mockResolvedValue({ ok: true });
    class MockWebClient {
        chat = { postMessage: mockPostMessage };
    }
    return { mockPostMessage, MockWebClient };
});
vi.mock('@slack/web-api', () => ({
    WebClient: MockWebClient,
}));

// Mock dependencies before importing the handler
vi.mock('@copilotkit/outpost/db', () => mockPrisma());
vi.mock('@copilotkit/outpost/queue', () => mockQueue());

vi.mock('../config.js', () => ({
    config: {
        slackBotToken: 'xoxb-test-token',
        slackAppToken: 'xapp-test-token',
        slackSigningSecret: 'test-signing-secret',
        monitoredChannelIds: ['C_MONITORED'],
        teamMemberIds: [],
    },
}));

vi.mock('../lib/tickets.js', () => ({
    isTeamMember: vi.fn().mockResolvedValue(false),
    findTicketByThreadTs: vi.fn().mockResolvedValue(null),
    buildPermalink: vi.fn(
        (channelId: string, ts: string) =>
            `https://slack.com/archives/${channelId}/p${ts.replace('.', '')}`,
    ),
}));

import { registerMessageHandler } from '../events/message.js';
import { prisma } from '@copilotkit/outpost/db';
import { createJob } from '@copilotkit/outpost/queue';

// Capture the event handler registered with app.event()
let messageHandler: (args: Record<string, unknown>) => Promise<void>;

function makeMockApp() {
    return {
        event: vi.fn((eventName: string, handler: (args: Record<string, unknown>) => Promise<void>) => {
            if (eventName === 'message') {
                messageHandler = handler;
            }
        }),
    };
}

const TICKET = {
    id: 'ticket-1',
    displayId: 'TKT-SL01',
    status: 'OPEN',
    priority: 'MEDIUM',
    source: 'SLACK',
    sourceId: 'C_MONITORED:1234567890.123456',
    channel: 'C_MONITORED',
};

describe('registerMessageHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        const app = makeMockApp();
        registerMessageHandler(app as unknown as Parameters<typeof registerMessageHandler>[0]);

        vi.mocked(prisma.ticket.create).mockResolvedValue({
            id: 'ticket-1',
            displayId: 'TKT-SL01',
        } as ReturnType<typeof prisma.ticket.create> extends Promise<infer T> ? T : never);

        vi.mocked(prisma.message.create).mockResolvedValue({
            id: 'msg-1',
        } as ReturnType<typeof prisma.message.create> extends Promise<infer T> ? T : never);

        // Default: not a team member (InboundHandler checks via prisma)
        vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.user.create).mockResolvedValue({
            id: 'user-1',
        } as ReturnType<typeof prisma.user.create> extends Promise<infer T> ? T : never);
    });

    it('registers a message event handler', () => {
        expect(messageHandler).toBeDefined();
    });

    describe('new top-level messages', () => {
        it('creates a ticket and enqueues AI response via adapter+handler flow', async () => {
            await messageHandler({
                event: {
                    user: 'U_EXTERNAL',
                    text: 'Help with CopilotKit integration',
                    ts: '1234567890.123456',
                    channel: 'C_MONITORED',
                },
            });

            // InboundHandler creates a ticket via prisma
            // Slack sourceId uses composite channelId:threadId format
            expect(prisma.ticket.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    source: 'SLACK',
                    sourceId: 'C_MONITORED:1234567890.123456',
                    status: 'OPEN',
                    priority: 'MEDIUM',
                    type: 'QUESTION',
                    channel: 'C_MONITORED',
                }),
            });

            // InboundHandler creates the first message record
            expect(prisma.message.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    ticketId: 'ticket-1',
                    type: 'USER',
                    author: 'slack:U_EXTERNAL (U_EXTERNAL)',
                }),
            });

            // InboundHandler enqueues AI response (uses string 'AI_RESPONSE', not enum)
            expect(createJob).toHaveBeenCalledWith(
                'AI_RESPONSE',
                expect.objectContaining({
                    ticketId: 'ticket-1',
                    source: 'slack',
                }),
            );

            // No acknowledgment post. It used to announce "TKT-XXXXXXXX created"
            // in-channel, leaking an internal identifier to the reporter and
            // spending an extra bot message. The AI response is the only message
            // the bot sends.
            expect(mockPostMessage).not.toHaveBeenCalled();
        });

        it('ignores messages in unmonitored channels', async () => {
            await messageHandler({
                event: {
                    user: 'U_EXTERNAL',
                    text: 'Hello',
                    ts: '1234567890.000000',
                    channel: 'C_OTHER',
                },
            });

            expect(prisma.ticket.create).not.toHaveBeenCalled();
        });

        it('ignores bot messages', async () => {
            await messageHandler({
                event: {
                    user: 'U_BOT',
                    bot_id: 'B_BOT',
                    text: 'Bot message',
                    ts: '1234567890.000000',
                    channel: 'C_MONITORED',
                },
            });

            expect(prisma.ticket.create).not.toHaveBeenCalled();
        });

        it('ignores message subtypes (edits, deletions, etc.)', async () => {
            await messageHandler({
                event: {
                    subtype: 'message_changed',
                    user: 'U_EXTERNAL',
                    text: 'Edited message',
                    ts: '1234567890.000000',
                    channel: 'C_MONITORED',
                },
            });

            expect(prisma.ticket.create).not.toHaveBeenCalled();
        });
    });

    describe('threaded replies', () => {
        beforeEach(() => {
            vi.mocked(prisma.ticket.findFirst).mockResolvedValue(
                TICKET as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never,
            );
        });

        // One response per ticket — thread replies are recorded, never answered.
        it('appends a message without enqueuing an AI response for non-team-member replies', async () => {
            await messageHandler({
                event: {
                    user: 'U_EXTERNAL',
                    text: 'I still need help with this',
                    ts: '1234567891.000000',
                    thread_ts: '1234567890.123456',
                    channel: 'C_MONITORED',
                },
            });

            expect(prisma.message.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    ticketId: 'ticket-1',
                    type: 'USER',
                    author: 'slack:U_EXTERNAL (U_EXTERNAL)',
                }),
            });

            expect(createJob).not.toHaveBeenCalled();
        });

        it('does not enqueue AI response for team member replies', async () => {
            // Set up InboundHandler's isTeamMember via prisma mocks
            vi.mocked(prisma.user.findFirst).mockResolvedValue({
                id: 'u-1',
                email: 'team@copilotkit.ai',
            } as ReturnType<typeof prisma.user.findFirst> extends Promise<infer T> ? T : never);
            vi.mocked(prisma.teamMember.findUnique).mockResolvedValue({
                id: 'tm-1',
            } as ReturnType<typeof prisma.teamMember.findUnique> extends Promise<infer T> ? T : never);

            await messageHandler({
                event: {
                    user: 'U_TEAM',
                    text: 'Let me help you with that',
                    ts: '1234567891.000000',
                    thread_ts: '1234567890.123456',
                    channel: 'C_MONITORED',
                },
            });

            // Should still save the message
            expect(prisma.message.create).toHaveBeenCalled();

            // Should NOT enqueue AI response
            expect(createJob).not.toHaveBeenCalled();
        });

        it('reopens ticket when customer replies to a resolved ticket', async () => {
            vi.mocked(prisma.ticket.findFirst).mockResolvedValue({
                ...TICKET,
                status: 'RESOLVED',
            } as ReturnType<typeof prisma.ticket.findFirst> extends Promise<infer T> ? T : never);

            await messageHandler({
                event: {
                    user: 'U_EXTERNAL',
                    text: 'Actually this is still broken',
                    ts: '1234567891.000000',
                    thread_ts: '1234567890.123456',
                    channel: 'C_MONITORED',
                },
            });

            expect(prisma.ticket.update).toHaveBeenCalledWith({
                where: { id: 'ticket-1' },
                data: { status: 'OPEN' },
            });
        });

        it('ignores threaded replies in untracked threads', async () => {
            vi.mocked(prisma.ticket.findFirst).mockResolvedValue(null);

            await messageHandler({
                event: {
                    user: 'U_EXTERNAL',
                    text: 'Random reply',
                    ts: '1234567891.000000',
                    thread_ts: '9999999999.000000',
                    channel: 'C_MONITORED',
                },
            });

            expect(prisma.message.create).not.toHaveBeenCalled();
        });
    });
});
