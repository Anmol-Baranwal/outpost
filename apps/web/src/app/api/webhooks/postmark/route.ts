/**
 * Postmark inbound email webhook.
 *
 * Receives inbound emails from Postmark and creates/updates tickets.
 * Postmark sends a POST with JSON containing:
 * - From, To, Subject, TextBody, HtmlBody, StrippedTextReply
 * - MailboxHash (plus-addressing: ticket+TKT-1234 -> TKT-1234)
 * - Headers, Attachments, MessageID
 */
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { generateTicketId, reopensOnCustomerReply } from '@copilotkit/outpost/shared';
import { createJob, JobType } from '@copilotkit/outpost/queue';
import { extractTicketId, extractEmail, extractName } from './utils';
import type { PostmarkInboundPayload } from './utils';

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

    if (!body.From || !body.Subject) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const senderEmail = extractEmail(body.From);
    const senderName = extractName(body.From, body.FromName);
    const messageBody = body.StrippedTextReply || body.TextBody || '';
    const ticketIdFromHash = extractTicketId(body.MailboxHash);

    try {
        // If we have a ticket ID from plus-addressing, append to existing ticket
        if (ticketIdFromHash) {
            const existingTicket = await prisma.ticket.findUnique({
                where: { displayId: ticketIdFromHash },
            });

            if (existingTicket) {
                // Append message to existing ticket
                await prisma.message.create({
                    data: {
                        ticketId: existingTicket.id,
                        author: `${senderName} <${senderEmail}>`,
                        content: messageBody,
                        type: 'USER',
                        attachments: body.Attachments?.length
                            ? {
                                  postmarkMessageId: body.MessageID,
                                  files: body.Attachments.map((a) => ({
                                      name: a.Name,
                                      contentType: a.ContentType,
                                      size: a.ContentLength,
                                  })),
                              }
                            : undefined,
                    },
                });

                // Re-open a dormant ticket so a human sees the reply. The status
                // set lives in @copilotkit/outpost/shared so this path, the
                // shared InboundHandler, and the GitHub App issue-comment
                // webhook cannot drift apart.
                if (reopensOnCustomerReply(existingTicket.status)) {
                    await prisma.ticket.update({
                        where: { id: existingTicket.id },
                        data: { status: 'OPEN', updatedAt: new Date() },
                    });
                }

                // No AI response on a reply — Outpost answers the opening email
                // once and a human handles the rest of the thread. Not enqueuing
                // here is what enforces that; the AI_RESPONSE handler's
                // already-answered gate only backstops re-answering a ticket that
                // already holds an AI response.

                return NextResponse.json({ status: 'message_appended', ticketId: existingTicket.displayId });
            }
        }

        // A parsed MailboxHash identifies a reply even when its original ticket
        // is gone. Preserve that orphaned reply as a new ticket/message for a
        // human, but do not spend an AI response on a mid-conversation message.
        const isOrphanedReply = ticketIdFromHash !== null;

        // Create new ticket from email
        const displayId = generateTicketId();
        const ticket = await prisma.ticket.create({
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
                        author: `${senderName} <${senderEmail}>`,
                        content: messageBody,
                        type: 'USER',
                        attachments: body.Attachments?.length
                            ? {
                                  postmarkMessageId: body.MessageID,
                                  files: body.Attachments.map((a) => ({
                                      name: a.Name,
                                      contentType: a.ContentType,
                                      size: a.ContentLength,
                                  })),
                              }
                            : undefined,
                    },
                },
            },
        });

        // Only a genuinely new email gets the ticket's single AI response.
        if (!isOrphanedReply) {
            await createJob(JobType.AI_RESPONSE, { ticketId: ticket.id, source: 'web' });
        }

        return NextResponse.json({ status: 'ticket_created', ticketId: ticket.displayId });
    } catch (err) {
        console.error('[Postmark Webhook] Error processing inbound email:', err);
        return NextResponse.json(
            { error: 'Internal error processing email' },
            { status: 500 },
        );
    }
}
