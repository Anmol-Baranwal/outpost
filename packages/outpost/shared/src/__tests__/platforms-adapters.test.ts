import { describe, it, expect } from 'vitest';
import { DiscordAdapter } from '../platforms/discord.js';
import { GitHubAdapter } from '../platforms/github.js';
import { SlackAdapter } from '../platforms/slack.js';
import { TeamsAdapter } from '../platforms/teams.js';
import { EmailPostmarkAdapter } from '../platforms/email-postmark.js';
import { TicketSource } from '../types.js';

// ── Discord Adapter ────────────────────────────────────────────────────

describe('DiscordAdapter', () => {
    const adapter = new DiscordAdapter({ token: 'test-token' });

    it('has platform set to DISCORD', () => {
        expect(adapter.platform).toBe(TicketSource.DISCORD);
    });

    describe('parseInboundEvent — thread create', () => {
        it('parses a thread create event correctly', () => {
            const rawEvent = {
                thread: {
                    id: 'thread-123',
                    parentId: 'forum-channel-1',
                    url: 'https://discord.com/channels/guild/forum/thread-123',
                },
                starterMessage: {
                    content: 'How do I integrate CopilotKit?',
                    author: {
                        id: '999888777',
                        tag: 'user#1234',
                        username: 'user',
                    },
                },
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.platformUserId).toBe('999888777');
            expect(result.platformUsername).toBe('user#1234');
            expect(result.content).toBe('How do I integrate CopilotKit?');
            expect(result.threadId).toBe('thread-123');
            expect(result.channelId).toBe('forum-channel-1');
            expect(result.source).toBe(TicketSource.DISCORD);
            expect(result.isThreadStart).toBe(true);
            expect(result.rawEvent).toBe(rawEvent);
        });

        it('handles missing starter message gracefully', () => {
            const rawEvent = {
                thread: {
                    id: 'thread-123',
                    parentId: 'forum-channel-1',
                },
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.platformUserId).toBe('');
            expect(result.platformUsername).toBe('Unknown');
            expect(result.content).toBe('');
            expect(result.isThreadStart).toBe(true);
        });
    });

    describe('parseInboundEvent — message', () => {
        it('parses a message event correctly', () => {
            const rawEvent = {
                message: {
                    content: 'Follow up question',
                    author: {
                        id: '111222333',
                        tag: 'dev#5678',
                    },
                    channel: {
                        id: 'thread-456',
                        parentId: 'forum-channel-1',
                    },
                    url: 'https://discord.com/channels/guild/thread-456/msg-789',
                },
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.platformUserId).toBe('111222333');
            expect(result.platformUsername).toBe('dev#5678');
            expect(result.content).toBe('Follow up question');
            expect(result.threadId).toBe('thread-456');
            expect(result.channelId).toBe('forum-channel-1');
            expect(result.source).toBe(TicketSource.DISCORD);
            expect(result.isThreadStart).toBe(false);
        });
    });

    describe('postResponse', () => {
        it('throws when ticket has no sourceId', async () => {
            await expect(
                adapter.postResponse(
                    { id: 'ticket-1', sourceId: null, channel: null, source: TicketSource.DISCORD },
                    { text: 'Response', truncated: false },
                ),
            ).rejects.toThrow('no sourceId');
        });
    });

    describe('postSystemMessage', () => {
        it('throws when ticket has no sourceId', async () => {
            await expect(
                adapter.postSystemMessage(
                    { id: 'ticket-1', sourceId: null, channel: null, source: TicketSource.DISCORD },
                    'System message',
                ),
            ).rejects.toThrow('no sourceId');
        });
    });
});

// ── GitHub Adapter ─────────────────────────────────────────────────────

describe('GitHubAdapter', () => {
    const adapter = new GitHubAdapter({
        appId: '12345',
        privateKey: 'test-key',
        installationId: 67890,
    });

    it('has platform set to GITHUB_ISSUE', () => {
        expect(adapter.platform).toBe(TicketSource.GITHUB_ISSUE);
    });

    describe('parseInboundEvent — issue opened', () => {
        it('parses a new issue event', () => {
            const rawEvent = {
                action: 'opened',
                issue: {
                    number: 42,
                    title: 'Bug report',
                    body: 'Something is broken',
                    html_url: 'https://github.com/org/repo/issues/42',
                },
                repository: { full_name: 'org/repo' },
                sender: { login: 'reporter', id: 12345 },
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.platformUserId).toBe('reporter');
            expect(result.platformUsername).toBe('reporter');
            expect(result.content).toBe('Something is broken');
            expect(result.threadId).toBe('org/repo#42');
            expect(result.channelId).toBe('org/repo');
            expect(result.sourceUrl).toBe('https://github.com/org/repo/issues/42');
            expect(result.source).toBe(TicketSource.GITHUB_ISSUE);
            expect(result.isThreadStart).toBe(true);
        });
    });

    describe('parseInboundEvent — issue comment', () => {
        it('parses an issue comment event', () => {
            const rawEvent = {
                action: 'created',
                comment: {
                    body: 'I have the same issue',
                    html_url: 'https://github.com/org/repo/issues/42#comment-1',
                },
                issue: { number: 42 },
                repository: { full_name: 'org/repo' },
                sender: { login: 'commenter' },
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.platformUserId).toBe('commenter');
            expect(result.content).toBe('I have the same issue');
            expect(result.threadId).toBe('org/repo#42');
            expect(result.source).toBe(TicketSource.GITHUB_ISSUE);
            expect(result.isThreadStart).toBe(false);
        });
    });

    describe('parseInboundEvent — discussion created', () => {
        it('parses a new discussion event', () => {
            const rawEvent = {
                action: 'created',
                discussion: {
                    number: 10,
                    body: 'How do I configure X?',
                    html_url: 'https://github.com/org/repo/discussions/10',
                },
                repository: { full_name: 'org/repo' },
                sender: { login: 'asker' },
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.platformUserId).toBe('asker');
            expect(result.content).toBe('How do I configure X?');
            expect(result.threadId).toBe('org/repo#10');
            expect(result.source).toBe(TicketSource.GITHUB_DISCUSSION);
            expect(result.isThreadStart).toBe(true);
        });
    });

    describe('parseInboundEvent — discussion comment', () => {
        it('parses a discussion comment event', () => {
            const rawEvent = {
                action: 'created',
                discussion: { number: 10 },
                comment: {
                    body: 'Try this approach',
                    html_url: 'https://github.com/org/repo/discussions/10#comment-5',
                },
                repository: { full_name: 'org/repo' },
                sender: { login: 'helper' },
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.platformUserId).toBe('helper');
            expect(result.content).toBe('Try this approach');
            expect(result.source).toBe(TicketSource.GITHUB_DISCUSSION);
            expect(result.isThreadStart).toBe(false);
        });
    });

    describe('postResponse', () => {
        it('throws when ticket has no sourceId', async () => {
            await expect(
                adapter.postResponse(
                    { id: 'ticket-1', sourceId: null, channel: null, source: TicketSource.GITHUB_ISSUE },
                    { text: 'Response', truncated: false },
                ),
            ).rejects.toThrow('no sourceId');
        });
    });
});

// ── Slack Adapter ──────────────────────────────────────────────────────

describe('SlackAdapter', () => {
    const adapter = new SlackAdapter({ token: 'xoxb-test-token' });

    it('has platform set to SLACK', () => {
        expect(adapter.platform).toBe(TicketSource.SLACK);
    });

    describe('parseInboundEvent — new top-level message', () => {
        it('parses a top-level message as thread start', () => {
            const rawEvent = {
                type: 'message',
                user: 'U1234567',
                text: 'How do I deploy?',
                ts: '1234567890.123456',
                channel: 'C0ABCDEF1',
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.platformUserId).toBe('U1234567');
            expect(result.platformUsername).toBe('slack:U1234567');
            expect(result.content).toBe('How do I deploy?');
            expect(result.threadId).toBe('1234567890.123456');
            expect(result.channelId).toBe('C0ABCDEF1');
            expect(result.source).toBe(TicketSource.SLACK);
            expect(result.isThreadStart).toBe(true);
            expect(result.sourceUrl).toContain('slack.com/archives/C0ABCDEF1/p');
        });

        it('treats message where thread_ts === ts as top-level', () => {
            const rawEvent = {
                type: 'message',
                user: 'U1234567',
                text: 'Top-level message',
                ts: '1234567890.123456',
                thread_ts: '1234567890.123456',
                channel: 'C0ABCDEF1',
            };

            const result = adapter.parseInboundEvent(rawEvent);
            expect(result.isThreadStart).toBe(true);
        });
    });

    describe('parseInboundEvent — threaded reply', () => {
        it('parses a threaded reply as non-thread-start', () => {
            const rawEvent = {
                type: 'message',
                user: 'U9876543',
                text: 'Here is how to deploy...',
                ts: '1234567891.654321',
                thread_ts: '1234567890.123456',
                channel: 'C0ABCDEF1',
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.platformUserId).toBe('U9876543');
            expect(result.content).toBe('Here is how to deploy...');
            expect(result.threadId).toBe('1234567890.123456'); // Parent ts
            expect(result.channelId).toBe('C0ABCDEF1');
            expect(result.source).toBe(TicketSource.SLACK);
            expect(result.isThreadStart).toBe(false);
        });
    });

    describe('postResponse', () => {
        it('throws when ticket has no sourceId', async () => {
            await expect(
                adapter.postResponse(
                    { id: 'ticket-1', sourceId: null, channel: 'C123', source: TicketSource.SLACK },
                    { text: 'Response', truncated: false },
                ),
            ).rejects.toThrow('missing sourceId or channel');
        });

        it('throws when ticket has no channel', async () => {
            await expect(
                adapter.postResponse(
                    { id: 'ticket-1', sourceId: 'C123:ts', channel: null, source: TicketSource.SLACK },
                    { text: 'Response', truncated: false },
                ),
            ).rejects.toThrow('missing sourceId or channel');
        });
    });
});

// ── Teams Adapter ──────────────────────────────────────────────────────

describe('TeamsAdapter', () => {
    const adapter = new TeamsAdapter({ appId: 'test-app-id', appPassword: 'test-password' });

    it('has platform set to TEAMS', () => {
        expect(adapter.platform).toBe(TicketSource.TEAMS);
    });

    describe('parseInboundEvent — new message', () => {
        it('parses a new Teams message without replyToId as thread start', () => {
            const rawEvent = {
                type: 'message',
                text: 'Need help with auth',
                from: {
                    id: 'teams-user-1',
                    name: 'Alice',
                    aadObjectId: 'aad-id-123',
                },
                recipient: { id: 'bot-id', name: 'Outpost Bot' },
                conversation: { id: 'conv-abc' },
                channelData: { teamsChannelId: 'team-channel-1' },
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.platformUserId).toBe('aad-id-123');
            expect(result.platformUsername).toContain('Alice');
            expect(result.content).toBe('Need help with auth');
            expect(result.threadId).toBe('conv-abc');
            expect(result.channelId).toBe('team-channel-1');
            expect(result.source).toBe(TicketSource.TEAMS);
            expect(result.isThreadStart).toBe(true);
        });
    });

    describe('parseInboundEvent — reply message', () => {
        it('parses a reply message (with replyToId) as non-thread-start', () => {
            const rawEvent = {
                type: 'message',
                text: 'Follow up',
                from: {
                    id: 'teams-user-2',
                    name: 'Bob',
                    aadObjectId: 'aad-id-456',
                },
                recipient: { id: 'bot-id', name: 'Outpost Bot' },
                conversation: { id: 'conv-abc' },
                replyToId: 'msg-prev-1',
                channelData: { teamsChannelId: 'team-channel-1' },
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.platformUserId).toBe('aad-id-456');
            expect(result.isThreadStart).toBe(false);
        });

        it('falls back to from.id when aadObjectId is missing', () => {
            const rawEvent = {
                type: 'message',
                text: 'No AAD ID',
                from: {
                    id: 'fallback-id',
                    name: 'Charlie',
                },
                conversation: { id: 'conv-xyz' },
            };

            const result = adapter.parseInboundEvent(rawEvent);
            expect(result.platformUserId).toBe('fallback-id');
        });
    });

    describe('postResponse', () => {
        it('throws when ticket has no sourceId', async () => {
            await expect(
                adapter.postResponse(
                    { id: 'ticket-1', sourceId: null, channel: null, source: TicketSource.TEAMS },
                    { text: 'Response', truncated: false },
                ),
            ).rejects.toThrow('no sourceId');
        });
    });
});

// ── Email Postmark Adapter ─────────────────────────────────────────────

describe('EmailPostmarkAdapter', () => {
    const adapter = new EmailPostmarkAdapter({
        apiKey: 'test-api-key',
        fromEmail: 'support@example.com',
    });

    it('has platform set to EMAIL', () => {
        expect(adapter.platform).toBe(TicketSource.EMAIL);
    });

    describe('parseInboundEvent — new email', () => {
        it('parses a Postmark inbound webhook for a new email', () => {
            const rawEvent = {
                FromFull: { Email: 'customer@example.com', Name: 'Customer' },
                ToFull: [{ Email: 'support@example.com', Name: 'Support' }],
                Subject: 'Help with integration',
                TextBody: 'I need help setting up the SDK',
                MessageID: 'msg-id-12345',
                Headers: [],
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.platformUserId).toBe('customer@example.com');
            expect(result.platformUsername).toBe('Customer');
            expect(result.content).toBe('I need help setting up the SDK');
            expect(result.threadId).toBe('msg-id-12345');
            expect(result.source).toBe(TicketSource.EMAIL);
            expect(result.isThreadStart).toBe(true);
        });
    });

    describe('parseInboundEvent — email reply', () => {
        it('parses a reply email (with In-Reply-To header) as non-thread-start', () => {
            const rawEvent = {
                FromFull: { Email: 'customer@example.com', Name: 'Customer' },
                Subject: 'Re: Help with integration',
                TextBody: 'Thanks, that worked!',
                MessageID: 'msg-id-67890',
                Headers: [
                    { Name: 'In-Reply-To', Value: 'msg-id-12345' },
                ],
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.isThreadStart).toBe(false);
            expect(result.threadId).toBe('msg-id-12345'); // References the original
        });
    });

    describe('parseInboundEvent — missing fields', () => {
        it('handles missing FromFull gracefully', () => {
            const rawEvent = {
                Subject: 'No sender',
                TextBody: 'Anonymous email',
                MessageID: 'msg-id-anon',
                Headers: [],
            };

            const result = adapter.parseInboundEvent(rawEvent);

            expect(result.platformUserId).toBe('');
            expect(result.platformUsername).toBe('');
        });

        it('falls back to subject when TextBody is empty', () => {
            const rawEvent = {
                FromFull: { Email: 'user@example.com', Name: 'User' },
                Subject: 'Important subject',
                TextBody: '',
                MessageID: 'msg-id-subject',
                Headers: [],
            };

            const result = adapter.parseInboundEvent(rawEvent);
            expect(result.content).toBe('Important subject');
        });
    });

    describe('fetchUserInfo', () => {
        it('returns the email as the primary identifier', async () => {
            const userInfo = await adapter.fetchUserInfo('customer@example.com');

            expect(userInfo.platformId).toBe('customer@example.com');
            expect(userInfo.email).toBe('customer@example.com');
        });
    });
});
