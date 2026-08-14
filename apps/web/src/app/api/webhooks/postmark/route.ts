/**
 * Postmark inbound email webhook.
 *
 * Receives inbound emails from Postmark and creates/updates tickets.
 * Postmark sends a POST with JSON containing:
 * - From, To, Subject, TextBody, HtmlBody, StrippedTextReply
 * - MailboxHash (plus-addressing: ticket+TKT-1234 -> TKT-1234)
 * - Headers, Attachments, MessageID
 *
 * One answer per ticket: a genuinely NEW email opens a ticket and gets exactly
 * one AI response; a REPLY is appended to its existing ticket and gets none.
 * Replies are detected first by `MailboxHash` (an exact ticket reference) and
 * then by the RFC 5322 threading headers `In-Reply-To` / `References`, which is
 * the only signal available when the customer's mail client replies to a plain
 * From address and drops the plus-address.
 */
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import {
    generateTicketId,
    MAX_JOB_ATTEMPTS,
    reopensOnCustomerReply,
} from '@copilotkit/outpost/shared';
import { JobType } from '@copilotkit/outpost/queue';
import {
    extractTicketId,
    extractEmail,
    extractName,
    extractReplyMessageIds,
    hasReplyHeaders,
} from './utils';
import type { PostmarkInboundPayload } from './utils';

/** Ticket fields the reply paths need. */
type ReplyTargetTicket = { id: string; displayId: string; status: string };

/**
 * Resolve a reply to the ticket that already holds its conversation.
 *
 * Two places carry inbound Message-IDs: `Ticket.sourceId` (the email that
 * OPENED the ticket) and `Message.attachments.postmarkMessageId` (every
 * appended message). A reply can name either, so both are checked. Outbound
 * Message-IDs are never persisted, which is why `References` (the full chain,
 * including the customer's own opening ID) matters as much as `In-Reply-To`.
 */
async function findTicketByReplyMessageIds(
    messageIds: string[],
): Promise<ReplyTargetTicket | null> {
    if (messageIds.length === 0) return null;

    // The opening email of a thread — the oldest match wins so a thread always
    // resolves to its root ticket.
    const openingTicket = await prisma.ticket.findFirst({
        where: { source: 'EMAIL', sourceId: { in: messageIds } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, displayId: true, status: true },
    });
    if (openingTicket) return openingTicket;

    // A message appended mid-thread.
    const appendedMessage = await prisma.message.findFirst({
        where: {
            ticket: { source: 'EMAIL' },
            OR: messageIds.map((id) => ({
                attachments: { path: ['postmarkMessageId'], equals: id },
            })),
        },
        orderBy: { createdAt: 'asc' },
        select: { ticket: { select: { id: true, displayId: true, status: true } } },
    });
    return appendedMessage?.ticket ?? null;
}

function isUniqueConstraintError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'P2002'
    );
}

function ticketCreatedResponse(ticket: { displayId: string }) {
    return NextResponse.json({ status: 'ticket_created', ticketId: ticket.displayId });
}

/**
 * Record the inbound Message-ID on every message, not just ones with files.
 * It is the only handle a later reply has on a mid-thread message, so it is
 * persisted unconditionally.
 */
function buildMessageAttachments(body: PostmarkInboundPayload) {
    return {
        postmarkMessageId: body.MessageID,
        ...(body.Attachments?.length
            ? {
                  files: body.Attachments.map((a) => ({
                      name: a.Name,
                      contentType: a.ContentType,
                      size: a.ContentLength,
                  })),
              }
            : {}),
    };
}

/**
 * Append a customer reply to the ticket that already owns the conversation.
 *
 * Shared by both reply paths (plus-address `MailboxHash` and RFC 5322 threading
 * headers) so they cannot drift: same message write, same reopen rule, and — in
 * both cases — no AI job. Outpost answers the opening email once and a human
 * owns the rest of the thread. Not enqueuing here is what enforces that; the
 * AI_RESPONSE handler's already-answered gate only backstops re-answering a
 * ticket that already holds an AI response.
 */
async function appendReplyToTicket(
    ticket: ReplyTargetTicket,
    body: PostmarkInboundPayload,
    author: string,
    content: string,
) {
    await prisma.message.create({
        data: {
            ticketId: ticket.id,
            author,
            content,
            type: 'USER',
            attachments: buildMessageAttachments(body),
        },
    });

    // Re-open a dormant ticket so a human sees the reply. The status set lives
    // in @copilotkit/outpost/shared so this path, the shared InboundHandler, and
    // the GitHub App issue-comment webhook cannot drift apart.
    if (reopensOnCustomerReply(ticket.status)) {
        await prisma.ticket.update({
            where: { id: ticket.id },
            data: { status: 'OPEN', updatedAt: new Date() },
        });
    }

    return NextResponse.json({ status: 'message_appended', ticketId: ticket.displayId });
}

export async function POST(request: Request) {
    // Webhook authentication via POSTMARK_WEBHOOK_TOKEN
    // Required in production; optional in development for local testing
    const webhookToken = process.env.POSTMARK_WEBHOOK_TOKEN;
    if (!webhookToken) {
        if (process.env.NODE_ENV === 'production') {
            return NextResponse.json(
                { error: 'Webhook authentication not configured' },
                { status: 500 },
            );
        }
        // Allow unauthenticated requests in non-production (local dev)
    } else {
        const authHeader = request.headers.get('authorization') ?? '';
        const expected = `Basic ${Buffer.from(webhookToken).toString('base64')}`;
        // Use timing-safe comparison to prevent timing attacks
        const authBuf = Buffer.from(authHeader);
        const expectedBuf = Buffer.from(expected);
        if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    let body: PostmarkInboundPayload;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (!body.From || !body.Subject || !body.MessageID) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const senderEmail = extractEmail(body.From);
    const senderName = extractName(body.From, body.FromName);
    const messageBody = body.StrippedTextReply || body.TextBody || '';
    const ticketIdFromHash = extractTicketId(body.MailboxHash);

    const author = `${senderName} <${senderEmail}>`;

    try {
        // MailboxHash is the primary reply path: it is an exact ticket reference
        // and cheaper than header matching.
        if (ticketIdFromHash) {
            const existingTicket = await prisma.ticket.findUnique({
                where: { displayId: ticketIdFromHash },
            });

            if (existingTicket) {
                return await appendReplyToTicket(existingTicket, body, author, messageBody);
            }
        } else {
            // Fallback: most mail clients reply to the plain From address and
            // never preserve the plus-address, so RFC 5322 threading headers are
            // the only thing marking those as replies.
            const replyTarget = await findTicketByReplyMessageIds(
                extractReplyMessageIds(body.Headers),
            );
            if (replyTarget) {
                return await appendReplyToTicket(replyTarget, body, author, messageBody);
            }
        }

        // A reply we could not resolve — a parsed MailboxHash or threading
        // headers whose thread has no ticket (deleted ticket, or a thread that
        // predates Outpost). Preserve the customer's words as a new
        // ticket/message for a human, but do not spend an AI response on a
        // mid-conversation message.
        const isOrphanedReply = ticketIdFromHash !== null || hasReplyHeaders(body.Headers);

        // Postmark retries the same inbound delivery with the same MessageID.
        // This read avoids deliberately colliding on the common retry path; the
        // partial unique index remains the concurrency authority when two first
        // deliveries pass this check together.
        const existingInboundTicket = await prisma.ticket.findFirst({
            where: { source: 'EMAIL', sourceId: body.MessageID },
            select: { id: true, displayId: true },
        });
        if (existingInboundTicket) {
            return ticketCreatedResponse(existingInboundTicket);
        }

        // Create the ticket (including its nested opening Message) and its one
        // AI_RESPONSE job in the same database transaction. A queue insert
        // failure rolls the ticket back, so Postmark can retry from a clean
        // state rather than creating a second ticket around a partial first run.
        const displayId = generateTicketId();
        let ticket: { id: string; displayId: string };
        try {
            ticket = await prisma.$transaction(async (tx) => {
                const createdTicket = await tx.ticket.create({
                    data: {
                        displayId,
                        title: body.Subject,
                        description: messageBody,
                        status: 'OPEN',
                        priority: 'MEDIUM',
                        type: 'QUESTION',
                        source: 'EMAIL',
                        sourceId: body.MessageID,
                        messages: {
                            create: {
                                author,
                                content: messageBody,
                                type: 'USER',
                                attachments: buildMessageAttachments(body),
                            },
                        },
                    },
                });

                // Only a genuinely new email gets the ticket's single AI response.
                if (!isOrphanedReply) {
                    await tx.job.create({
                        data: {
                            type: JobType.AI_RESPONSE,
                            payload: { ticketId: createdTicket.id, source: 'web' },
                            maxAttempts: MAX_JOB_ATTEMPTS,
                        },
                    });
                }

                return createdTicket;
            });
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                const concurrentTicket = await prisma.ticket.findFirst({
                    where: { source: 'EMAIL', sourceId: body.MessageID },
                    select: { id: true, displayId: true },
                });
                if (concurrentTicket) return ticketCreatedResponse(concurrentTicket);
            }
            throw error;
        }

        return ticketCreatedResponse(ticket);
    } catch (err) {
        console.error('[Postmark Webhook] Error processing inbound email:', err);
        return NextResponse.json(
            { error: 'Internal error processing email' },
            { status: 500 },
        );
    }
}
