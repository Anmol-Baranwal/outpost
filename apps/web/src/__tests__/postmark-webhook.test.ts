/**
 * Tests for the Postmark inbound email webhook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Prisma ────────────────────────────────────────────────────────────

const mockTicketFindUnique = vi.fn();
const mockTicketCreate = vi.fn();
const mockTicketUpdate = vi.fn();
const mockMessageCreate = vi.fn();

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        ticket: {
            findUnique: (...args: unknown[]) => mockTicketFindUnique(...args),
            create: (...args: unknown[]) => mockTicketCreate(...args),
            update: (...args: unknown[]) => mockTicketUpdate(...args),
        },
        message: {
            create: (...args: unknown[]) => mockMessageCreate(...args),
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
import { extractTicketId, extractEmail, extractName } from '@/app/api/webhooks/postmark/utils';
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

            // Should enqueue AI_RESPONSE job
            expect(mockCreateJob).toHaveBeenCalledWith(
                'AI_RESPONSE',
                { ticketId: 'ticket-1', source: 'web' },
            );
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
