/**
 * Tests for the Postmark inbound email webhook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ────────────────────────────────────────────────────────────

const mockTicketFindUnique = vi.fn();
const mockTicketFindFirst = vi.fn();
const mockTicketCreate = vi.fn();
const mockTicketUpdate = vi.fn();
const mockMessageCreate = vi.fn();
const mockMessageFindFirst = vi.fn();
const mockJobCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        $transaction: (...args: unknown[]) => mockTransaction(...args),
        ticket: {
            findUnique: (...args: unknown[]) => mockTicketFindUnique(...args),
            findFirst: (...args: unknown[]) => mockTicketFindFirst(...args),
            create: (...args: unknown[]) => mockTicketCreate(...args),
            update: (...args: unknown[]) => mockTicketUpdate(...args),
        },
        message: {
            create: (...args: unknown[]) => mockMessageCreate(...args),
            findFirst: (...args: unknown[]) => mockMessageFindFirst(...args),
        },
        job: {
            create: (...args: unknown[]) => mockJobCreate(...args),
        },
    },
}));

// ─── Mock generateTicketId ──────────────────────────────────────────────────

// reopensOnCustomerReply is deliberately NOT stubbed — this webhook and the
// shared InboundHandler must agree on which statuses a reply reopens, so the
// test exercises the real shared implementation.
vi.mock('@copilotkit/outpost/shared', async (importActual) => ({
    ...(await importActual<typeof import('@copilotkit/outpost/shared')>()),
    generateTicketId: vi.fn().mockReturnValue('TKT-TESTID01'),
}));

// ─── Mock queue ────────────────────────────────────────────────────────────

const mockCreateJob = vi.fn().mockResolvedValue('job-1');

vi.mock('@copilotkit/outpost/queue', () => ({
    createJob: (...args: unknown[]) => mockCreateJob(...args),
    JobType: { AI_RESPONSE: 'AI_RESPONSE' },
}));

// ─── Import route + helpers ─────────────────────────────────────────────────

import { POST } from '@/app/api/webhooks/postmark/route';
import {
    extractTicketId,
    extractEmail,
    extractName,
    extractReplyMessageIds,
    getHeaderValue,
    hasReplyHeaders,
    normalizeMessageId,
} from '@/app/api/webhooks/postmark/utils';
import type { PostmarkInboundPayload } from '@/app/api/webhooks/postmark/utils';

// ─── Helpers ────────────────────────────────────────────────────────────────

function postmarkRequest(payload: Partial<PostmarkInboundPayload>): Request {
    return new Request('http://localhost:3000/api/webhooks/postmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

function fullPayload(overrides: Partial<PostmarkInboundPayload> = {}): PostmarkInboundPayload {
    return {
        From: 'Alice Smith <alice@example.com>',
        FromName: 'Alice Smith',
        To: 'support@outpost.dev',
        Subject: 'Need help with billing',
        TextBody: 'I have a question about my invoice.',
        HtmlBody: '<p>I have a question about my invoice.</p>',
        MessageID: 'msg-001@postmark.example',
        ...overrides,
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Postmark inbound webhook', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTicketCreate.mockReset();
        mockTicketFindFirst.mockReset();
        mockJobCreate.mockReset();
        mockTransaction.mockReset();
        mockCreateJob.mockReset();
        mockMessageFindFirst.mockReset();
        mockTicketFindUnique.mockReset();
        mockTicketFindFirst.mockResolvedValue(null);
        mockMessageFindFirst.mockResolvedValue(null);
        mockTicketFindUnique.mockResolvedValue(null);
        mockJobCreate.mockResolvedValue({ id: 'job-1' });
        mockCreateJob.mockResolvedValue('job-1');
        mockTransaction.mockImplementation(
            async (
                callback: (tx: {
                    ticket: { create: typeof mockTicketCreate };
                    job: { create: typeof mockJobCreate };
                }) => Promise<unknown>,
            ) =>
                callback({
                    ticket: { create: mockTicketCreate },
                    job: { create: mockJobCreate },
                }),
        );
    });

    // ── Helper function tests ──────────────────────────────────────────────

    describe('extractTicketId', () => {
        it('extracts ticket ID from MailboxHash', () => {
            expect(extractTicketId('TKT-AB12CD34')).toBe('TKT-AB12CD34');
        });

        it('uppercases the ticket ID', () => {
            expect(extractTicketId('tkt-ab12cd34')).toBe('TKT-AB12CD34');
        });

        it('returns null for empty string', () => {
            expect(extractTicketId('')).toBeNull();
        });

        it('returns null for undefined', () => {
            expect(extractTicketId(undefined)).toBeNull();
        });

        it('returns null for invalid format', () => {
            expect(extractTicketId('not-a-ticket-id')).toBeNull();
        });
    });

    describe('extractEmail', () => {
        it('extracts email from angle-bracket format', () => {
            expect(extractEmail('Alice <alice@test.com>')).toBe('alice@test.com');
        });

        it('returns raw string when no angle brackets', () => {
            expect(extractEmail('alice@test.com')).toBe('alice@test.com');
        });
    });

    describe('extractName', () => {
        it('uses fromName when provided', () => {
            expect(extractName('Alice <alice@test.com>', 'Alice Smith')).toBe('Alice Smith');
        });

        it('extracts name from angle-bracket format', () => {
            expect(extractName('Alice Smith <alice@test.com>')).toBe('Alice Smith');
        });

        it('returns full string when no angle brackets', () => {
            expect(extractName('alice@test.com')).toBe('alice@test.com');
        });
    });

    // Postmark's MessageID field is bare while header values are angle-bracketed
    // and may be folded across lines. If normalization is off by a bracket the
    // route silently stops recognizing replies, so it is tested directly.
    describe('normalizeMessageId', () => {
        it('strips angle brackets', () => {
            expect(normalizeMessageId('<abc@example.com>')).toBe('abc@example.com');
        });

        it('leaves a bare ID untouched', () => {
            expect(normalizeMessageId('abc@example.com')).toBe('abc@example.com');
        });

        it('strips surrounding and inner-edge whitespace, including folded lines', () => {
            expect(normalizeMessageId('\r\n\t <abc@example.com> ')).toBe('abc@example.com');
            expect(normalizeMessageId('< abc@example.com >')).toBe('abc@example.com');
        });

        it('returns null for empty, bracket-only, and missing values', () => {
            expect(normalizeMessageId('')).toBeNull();
            expect(normalizeMessageId('   ')).toBeNull();
            expect(normalizeMessageId('<>')).toBeNull();
            expect(normalizeMessageId(undefined)).toBeNull();
            expect(normalizeMessageId(null)).toBeNull();
        });
    });

    describe('getHeaderValue', () => {
        it('matches header names case-insensitively', () => {
            const list = [{ Name: 'in-REPLY-to', Value: '<a@b>' }];
            expect(getHeaderValue(list, 'In-Reply-To')).toBe('<a@b>');
        });

        it('returns undefined for a missing header or missing list', () => {
            expect(getHeaderValue([{ Name: 'Date', Value: 'x' }], 'References')).toBeUndefined();
            expect(getHeaderValue(undefined, 'References')).toBeUndefined();
        });
    });

    describe('extractReplyMessageIds', () => {
        it('collects In-Reply-To and the whole References chain, normalized and deduped', () => {
            expect(
                extractReplyMessageIds([
                    { Name: 'In-Reply-To', Value: '<b@x>' },
                    { Name: 'References', Value: '<a@x> <b@x>\r\n\t<c@x>' },
                ]),
            ).toEqual(['b@x', 'a@x', 'c@x']);
        });

        it('tolerates comma-separated References', () => {
            expect(extractReplyMessageIds([{ Name: 'References', Value: '<a@x>, <b@x>' }])).toEqual(
                ['a@x', 'b@x'],
            );
        });

        it('returns an empty list when there are no threading headers', () => {
            expect(extractReplyMessageIds([{ Name: 'Subject', Value: 'hi' }])).toEqual([]);
            expect(extractReplyMessageIds(undefined)).toEqual([]);
        });

        it('drops unparseable tokens', () => {
            expect(extractReplyMessageIds([{ Name: 'In-Reply-To', Value: '<>' }])).toEqual([]);
        });
    });

    describe('hasReplyHeaders', () => {
        it('is true for a non-empty In-Reply-To or References', () => {
            expect(hasReplyHeaders([{ Name: 'In-Reply-To', Value: '<a@x>' }])).toBe(true);
            expect(hasReplyHeaders([{ Name: 'References', Value: '<a@x>' }])).toBe(true);
        });

        it('is true even when the value cannot be parsed into an ID', () => {
            // A malformed threading header is still proof this is a reply, so the
            // bot must stay silent rather than answering mid-conversation.
            expect(hasReplyHeaders([{ Name: 'In-Reply-To', Value: '<>' }])).toBe(true);
        });

        it('is false for whitespace-only, absent, and undefined headers', () => {
            expect(hasReplyHeaders([{ Name: 'References', Value: '  ' }])).toBe(false);
            expect(hasReplyHeaders([{ Name: 'Subject', Value: 'hi' }])).toBe(false);
            expect(hasReplyHeaders(undefined)).toBe(false);
        });
    });

    // ── Route handler tests ────────────────────────────────────────────────

    describe('POST handler', () => {
        it('creates a new ticket from a new email', async () => {
            mockTicketCreate.mockResolvedValue({
                id: 'ticket-1',
                displayId: 'TKT-TESTID01',
            });

            const res = await POST(postmarkRequest(fullPayload()));
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body.status).toBe('ticket_created');
            expect(body.ticketId).toBe('TKT-TESTID01');

            expect(mockTicketCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        displayId: 'TKT-TESTID01',
                        title: 'Need help with billing',
                        description: 'I have a question about my invoice.',
                        source: 'EMAIL',
                        sourceId: 'msg-001@postmark.example',
                    }),
                }),
            );

            // Ticket, opening message, and AI job share one transaction.
            expect(mockTransaction).toHaveBeenCalledTimes(1);
            expect(mockJobCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    type: 'AI_RESPONSE',
                    payload: { ticketId: 'ticket-1', source: 'web' },
                }),
            });
            expect(mockCreateJob).not.toHaveBeenCalled();
        });

        it('creates one ticket and AI job for concurrent deliveries of the same MessageID', async () => {
            const ticket = {
                id: 'ticket-concurrent',
                displayId: 'TKT-TESTID01',
                source: 'EMAIL',
                sourceId: 'msg-001@postmark.example',
            };
            mockTicketFindFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null)
                .mockResolvedValue(ticket);

            let sourceIdClaimed = false;
            mockTicketCreate.mockImplementation(async () => {
                if (sourceIdClaimed) {
                    throw {
                        code: 'P2002',
                        meta: { target: 'Ticket_email_sourceId_key' },
                    };
                }
                sourceIdClaimed = true;
                return ticket;
            });

            const [first, second] = await Promise.all([
                POST(postmarkRequest(fullPayload())),
                POST(postmarkRequest(fullPayload())),
            ]);

            expect(first.status).toBe(200);
            expect(second.status).toBe(200);
            expect(await first.json()).toMatchObject({ ticketId: 'TKT-TESTID01' });
            expect(await second.json()).toMatchObject({ ticketId: 'TKT-TESTID01' });
            expect(mockTicketCreate).toHaveBeenCalledTimes(2);
            expect(mockJobCreate).toHaveBeenCalledTimes(1);
            expect(mockCreateJob).not.toHaveBeenCalled();
        });

        it('rolls back ticket creation when the atomic AI job insert fails, then retries once', async () => {
            const ticket = {
                id: 'ticket-after-retry',
                displayId: 'TKT-TESTID01',
                source: 'EMAIL',
                sourceId: 'msg-001@postmark.example',
            };
            let committedTicket: typeof ticket | null = null;
            let committedJobs = 0;
            let ticketAttempts = 0;
            let failJobInsert = true;

            mockTicketFindFirst.mockImplementation(async () => committedTicket);
            mockTransaction.mockImplementation(
                async (
                    callback: (tx: {
                        ticket: { create: () => Promise<typeof ticket> };
                        job: { create: () => Promise<{ id: string }> };
                    }) => Promise<unknown>,
                ) => {
                    let stagedTicket: typeof ticket | null = null;
                    let stagedJob = false;
                    const result = await callback({
                        ticket: {
                            create: async () => {
                                ticketAttempts += 1;
                                stagedTicket = ticket;
                                return ticket;
                            },
                        },
                        job: {
                            create: async () => {
                                if (failJobInsert) {
                                    failJobInsert = false;
                                    throw new Error('queue insert unavailable');
                                }
                                stagedJob = true;
                                return { id: 'job-after-retry' };
                            },
                        },
                    });
                    committedTicket = stagedTicket;
                    if (stagedJob) committedJobs += 1;
                    return result;
                },
            );

            const first = await POST(postmarkRequest(fullPayload()));
            const retry = await POST(postmarkRequest(fullPayload()));

            expect(first.status).toBe(500);
            expect(retry.status).toBe(200);
            expect(ticketAttempts).toBe(2);
            expect(committedTicket).toEqual(ticket);
            expect(committedJobs).toBe(1);
            expect(mockTransaction).toHaveBeenCalledTimes(2);
            expect(mockCreateJob).not.toHaveBeenCalled();
        });

        it('appends to existing ticket via MailboxHash (plus-addressing)', async () => {
            mockTicketFindUnique.mockResolvedValue({
                id: 'existing-ticket-1',
                displayId: 'TKT-EXIST123',
                status: 'OPEN',
            });
            mockMessageCreate.mockResolvedValue({ id: 'msg-1' });

            const res = await POST(
                postmarkRequest(
                    fullPayload({
                        MailboxHash: 'TKT-EXIST123',
                        Subject: 'Re: Need help with billing',
                        TextBody: 'Thanks for the update!',
                    }),
                ),
            );

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe('message_appended');
            expect(body.ticketId).toBe('TKT-EXIST123');

            expect(mockMessageCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        ticketId: 'existing-ticket-1',
                        content: 'Thanks for the update!',
                        type: 'USER',
                    }),
                }),
            );

            // Should NOT create a new ticket
            expect(mockTicketCreate).not.toHaveBeenCalled();

            // Should NOT enqueue AI_RESPONSE for the reply — one answer per
            // ticket, on the opening email only. A human owns the thread after
            // the first response.
            expect(mockCreateJob).not.toHaveBeenCalled();
        });

        it('uses StrippedTextReply when available', async () => {
            mockTicketCreate.mockResolvedValue({
                id: 'ticket-stripped',
                displayId: 'TKT-TESTID01',
            });

            const res = await POST(
                postmarkRequest(
                    fullPayload({
                        TextBody: 'Full email with quoted text\n\n> Original message...',
                        StrippedTextReply: 'Just the reply part',
                    }),
                ),
            );

            expect(res.status).toBe(200);
            expect(mockTicketCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        description: 'Just the reply part',
                    }),
                }),
            );
        });

        it('re-opens resolved ticket on new inbound reply', async () => {
            mockTicketFindUnique.mockResolvedValue({
                id: 'resolved-ticket',
                displayId: 'TKT-RESOLVED',
                status: 'RESOLVED',
            });
            mockMessageCreate.mockResolvedValue({ id: 'msg-reopen' });
            mockTicketUpdate.mockResolvedValue({});

            await POST(
                postmarkRequest(
                    fullPayload({
                        MailboxHash: 'TKT-RESOLVED',
                    }),
                ),
            );

            expect(mockTicketUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'resolved-ticket' },
                    data: expect.objectContaining({ status: 'OPEN' }),
                }),
            );
        });

        // WAITING_ON_CUSTOMER used to be missing from this path's status list, so
        // an email reply to a ticket that was waiting on the customer stayed out
        // of the queue entirely — replies no longer trigger an AI response, so
        // the reopen is the only signal that reaches a human.
        it.each(['WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'])(
            're-opens a %s ticket on a new inbound reply',
            async (status) => {
                mockTicketFindUnique.mockResolvedValue({
                    id: 'dormant-ticket',
                    displayId: 'TKT-DORMANT1',
                    status,
                });
                mockMessageCreate.mockResolvedValue({ id: 'msg-reopen' });
                mockTicketUpdate.mockResolvedValue({});

                await POST(postmarkRequest(fullPayload({ MailboxHash: 'TKT-DORMANT1' })));

                expect(mockTicketUpdate).toHaveBeenCalledWith(
                    expect.objectContaining({
                        where: { id: 'dormant-ticket' },
                        data: expect.objectContaining({ status: 'OPEN' }),
                    }),
                );
            },
        );

        it.each(['OPEN', 'IN_PROGRESS', 'WAITING_ON_TEAM'])(
            'leaves a %s ticket status untouched on a new inbound reply',
            async (status) => {
                mockTicketFindUnique.mockResolvedValue({
                    id: 'live-ticket',
                    displayId: 'TKT-LIVE0001',
                    status,
                });
                mockMessageCreate.mockResolvedValue({ id: 'msg-append' });

                await POST(postmarkRequest(fullPayload({ MailboxHash: 'TKT-LIVE0001' })));

                expect(mockMessageCreate).toHaveBeenCalled();
                expect(mockTicketUpdate).not.toHaveBeenCalled();
            },
        );

        it('files an orphaned reply without enqueueing an AI response', async () => {
            mockTicketFindUnique.mockResolvedValue(null);
            mockTicketCreate.mockResolvedValue({
                id: 'new-ticket',
                displayId: 'TKT-TESTID01',
            });

            const res = await POST(
                postmarkRequest(
                    fullPayload({
                        MailboxHash: 'TKT-NOTEXIST',
                    }),
                ),
            );

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe('ticket_created');
            expect(mockTicketCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        description: 'I have a question about my invoice.',
                        messages: expect.objectContaining({
                            create: expect.objectContaining({
                                content: 'I have a question about my invoice.',
                                type: 'USER',
                            }),
                        }),
                    }),
                }),
            );
            expect(mockCreateJob).not.toHaveBeenCalled();
        });

        // ── Reply detection via RFC 5322 threading headers ──────────────────
        //
        // MailboxHash only survives when the customer's client preserves the
        // plus-address. The normal case is a reply to a plain From address, which
        // carries In-Reply-To / References and nothing else. Those replies used to
        // fall through to the new-ticket branch and got a second AI answer for a
        // conversation already in progress.

        /** Build a Postmark Headers array for a reply. */
        function headers(inReplyTo?: string, references?: string) {
            const list = [
                { Name: 'Date', Value: 'Mon, 3 Feb 2025 10:00:00 +0000' },
                { Name: 'Subject', Value: 'Re: Need help with billing' },
            ];
            if (inReplyTo !== undefined) list.push({ Name: 'In-Reply-To', Value: inReplyTo });
            if (references !== undefined) list.push({ Name: 'References', Value: references });
            return list;
        }

        /**
         * Answer the reply-resolution ticket lookup (`sourceId: { in: [...] }`)
         * from a map, while leaving the MessageID idempotency lookup
         * (`sourceId: '<string>'`) returning null.
         */
        function ticketsBySourceId(map: Record<string, unknown>) {
            mockTicketFindFirst.mockImplementation(async (args: unknown) => {
                const where = (args as { where?: { sourceId?: { in?: string[] } } }).where;
                const ids = where?.sourceId?.in;
                if (!Array.isArray(ids)) return null;
                for (const id of ids) {
                    if (map[id]) return map[id];
                }
                return null;
            });
        }

        it('appends a reply whose In-Reply-To matches a ticket sourceId, with no AI job', async () => {
            ticketsBySourceId({
                'root-msg@postmark.example': {
                    id: 'ticket-root',
                    displayId: 'TKT-ROOT0001',
                    status: 'OPEN',
                },
            });
            mockMessageCreate.mockResolvedValue({ id: 'msg-appended' });

            const res = await POST(
                postmarkRequest(
                    fullPayload({
                        MessageID: 'reply-msg@postmark.example',
                        Subject: 'Re: Need help with billing',
                        TextBody: 'Any update on this?',
                        Headers: headers('<root-msg@postmark.example>'),
                    }),
                ),
            );

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({
                status: 'message_appended',
                ticketId: 'TKT-ROOT0001',
            });
            expect(mockMessageCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        ticketId: 'ticket-root',
                        content: 'Any update on this?',
                        // Every appended message records its inbound Message-ID so a
                        // later reply can resolve to this mid-thread message.
                        attachments: expect.objectContaining({
                            postmarkMessageId: 'reply-msg@postmark.example',
                        }),
                    }),
                }),
            );
            // The whole point: no second ticket, no second answer.
            expect(mockTicketCreate).not.toHaveBeenCalled();
            expect(mockTransaction).not.toHaveBeenCalled();
            expect(mockJobCreate).not.toHaveBeenCalled();
            expect(mockCreateJob).not.toHaveBeenCalled();
        });

        it('resolves a reply through the References chain when In-Reply-To names an outbound ID we never stored', async () => {
            // Outbound Message-IDs are not persisted (postResponse is unimplemented),
            // so a reply to our own message names an ID no row holds. References
            // still carries the customer's opening Message-ID.
            ticketsBySourceId({
                'root-msg@postmark.example': {
                    id: 'ticket-root',
                    displayId: 'TKT-ROOT0001',
                    status: 'WAITING_ON_CUSTOMER',
                },
            });
            mockMessageCreate.mockResolvedValue({ id: 'msg-appended' });
            mockTicketUpdate.mockResolvedValue({});

            const res = await POST(
                postmarkRequest(
                    fullPayload({
                        MessageID: 'reply-msg@postmark.example',
                        Headers: headers(
                            '<outbound-never-stored@outpost.dev>',
                            '<root-msg@postmark.example>\r\n\t<outbound-never-stored@outpost.dev>',
                        ),
                    }),
                ),
            );

            expect(await res.json()).toMatchObject({
                status: 'message_appended',
                ticketId: 'TKT-ROOT0001',
            });
            // Dormant ticket reopens so a human sees the reply.
            expect(mockTicketUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'ticket-root' },
                    data: expect.objectContaining({ status: 'OPEN' }),
                }),
            );
            expect(mockJobCreate).not.toHaveBeenCalled();
        });

        it('resolves a reply that matches a mid-thread Message.attachments.postmarkMessageId', async () => {
            ticketsBySourceId({});
            mockMessageFindFirst.mockResolvedValue({
                ticket: { id: 'ticket-mid', displayId: 'TKT-MID00001', status: 'OPEN' },
            });
            mockMessageCreate.mockResolvedValue({ id: 'msg-appended' });

            const res = await POST(
                postmarkRequest(
                    fullPayload({
                        MessageID: 'reply-msg@postmark.example',
                        Headers: headers('<mid-thread@postmark.example>'),
                    }),
                ),
            );

            expect(await res.json()).toMatchObject({
                status: 'message_appended',
                ticketId: 'TKT-MID00001',
            });
            expect(mockMessageFindFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        OR: [
                            {
                                attachments: {
                                    path: ['postmarkMessageId'],
                                    equals: 'mid-thread@postmark.example',
                                },
                            },
                        ],
                    }),
                }),
            );
            expect(mockTicketCreate).not.toHaveBeenCalled();
            expect(mockJobCreate).not.toHaveBeenCalled();
        });

        it('files a reply whose headers resolve to nothing as a ticket with no AI job', async () => {
            ticketsBySourceId({});
            mockTicketCreate.mockResolvedValue({
                id: 'ticket-orphan-header',
                displayId: 'TKT-TESTID01',
            });

            const res = await POST(
                postmarkRequest(
                    fullPayload({
                        MessageID: 'reply-msg@postmark.example',
                        TextBody: 'Following up on the thread from last year.',
                        Headers: headers('<long-deleted@postmark.example>'),
                    }),
                ),
            );

            expect(res.status).toBe(200);
            expect(await res.json()).toMatchObject({ status: 'ticket_created' });
            // Kept for a human...
            expect(mockTicketCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        description: 'Following up on the thread from last year.',
                    }),
                }),
            );
            // ...but never answered.
            expect(mockJobCreate).not.toHaveBeenCalled();
            expect(mockCreateJob).not.toHaveBeenCalled();
        });

        it('still answers a genuinely new email that carries headers but no threading headers', async () => {
            mockTicketCreate.mockResolvedValue({ id: 'ticket-new', displayId: 'TKT-TESTID01' });

            const res = await POST(
                postmarkRequest(
                    fullPayload({
                        Headers: [
                            { Name: 'Date', Value: 'Mon, 3 Feb 2025 10:00:00 +0000' },
                            { Name: 'Subject', Value: 'Need help with billing' },
                            { Name: 'Message-ID', Value: '<msg-001@postmark.example>' },
                        ],
                    }),
                ),
            );

            expect(res.status).toBe(200);
            expect(await res.json()).toMatchObject({ status: 'ticket_created' });
            // The fix must not blanket-mute email: a new ticket still gets its one job.
            expect(mockJobCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    type: 'AI_RESPONSE',
                    payload: { ticketId: 'ticket-new', source: 'web' },
                }),
            });
            // No threading headers means no header lookups at all.
            expect(mockMessageFindFirst).not.toHaveBeenCalled();
        });

        it('treats an empty References header as not-a-reply', async () => {
            mockTicketCreate.mockResolvedValue({ id: 'ticket-new', displayId: 'TKT-TESTID01' });

            await POST(postmarkRequest(fullPayload({ Headers: headers(undefined, '   ') })));

            expect(mockJobCreate).toHaveBeenCalledTimes(1);
        });

        it('keeps MailboxHash as the primary reply path, without header lookups', async () => {
            mockTicketFindUnique.mockResolvedValue({
                id: 'hash-ticket',
                displayId: 'TKT-HASH0001',
                status: 'OPEN',
            });
            mockMessageCreate.mockResolvedValue({ id: 'msg-appended' });

            const res = await POST(
                postmarkRequest(
                    fullPayload({
                        MailboxHash: 'TKT-HASH0001',
                        Headers: headers('<root-msg@postmark.example>'),
                    }),
                ),
            );

            expect(await res.json()).toMatchObject({ ticketId: 'TKT-HASH0001' });
            expect(mockTicketFindFirst).not.toHaveBeenCalled();
            expect(mockMessageFindFirst).not.toHaveBeenCalled();
        });

        it('files an unresolvable MailboxHash reply without falling back to headers', async () => {
            mockTicketFindUnique.mockResolvedValue(null);
            mockTicketCreate.mockResolvedValue({
                id: 'ticket-orphan-hash',
                displayId: 'TKT-TESTID01',
            });

            await POST(
                postmarkRequest(
                    fullPayload({
                        MailboxHash: 'TKT-NOTEXIST',
                        Headers: headers('<root-msg@postmark.example>'),
                    }),
                ),
            );

            expect(mockMessageFindFirst).not.toHaveBeenCalled();
            expect(mockJobCreate).not.toHaveBeenCalled();
        });

        it('handles attachments in the payload', async () => {
            mockTicketCreate.mockResolvedValue({
                id: 'ticket-attach',
                displayId: 'TKT-TESTID01',
            });

            await POST(
                postmarkRequest(
                    fullPayload({
                        Attachments: [
                            {
                                Name: 'screenshot.png',
                                Content: 'base64data...',
                                ContentType: 'image/png',
                                ContentLength: 12345,
                            },
                        ],
                    }),
                ),
            );

            expect(mockTicketCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        messages: expect.objectContaining({
                            create: expect.objectContaining({
                                attachments: expect.objectContaining({
                                    files: [
                                        expect.objectContaining({
                                            name: 'screenshot.png',
                                            contentType: 'image/png',
                                            size: 12345,
                                        }),
                                    ],
                                }),
                            }),
                        }),
                    }),
                }),
            );
        });

        it('rejects invalid JSON', async () => {
            const req = new Request('http://localhost:3000/api/webhooks/postmark', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: 'not-json',
            });

            const res = await POST(req);
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error).toBe('Invalid JSON');
        });

        it('rejects payload missing From', async () => {
            const res = await POST(postmarkRequest({ Subject: 'Test', From: '' }));
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error).toBe('Missing required fields');
        });

        it('rejects payload missing Subject', async () => {
            const res = await POST(
                postmarkRequest({ From: 'alice@test.com', Subject: '' }),
            );
            expect(res.status).toBe(400);
        });

        it('rejects a new-email payload without the MessageID required for idempotency', async () => {
            const res = await POST(
                postmarkRequest(fullPayload({ MessageID: '' })),
            );

            expect(res.status).toBe(400);
            expect(mockTransaction).not.toHaveBeenCalled();
        });

        it('returns 500 on database error', async () => {
            mockTicketCreate.mockRejectedValue(new Error('DB connection failed'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const res = await POST(postmarkRequest(fullPayload()));
            expect(res.status).toBe(500);

            const body = await res.json();
            expect(body.error).toContain('Internal error');

            consoleSpy.mockRestore();
        });
    });
});
