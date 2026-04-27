/**
 * Postmark inbound email webhook.
 *
 * Receives inbound emails from Postmark and creates/updates tickets.
 * Postmark sends a POST with JSON containing:
 * - From, To, Subject, TextBody, HtmlBody, StrippedTextReply
 * - MailboxHash (plus-addressing: ticket+TKT-1234 -> TKT-1234)
 * - Headers, Attachments, MessageID
 */
import { NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { generateTicketId } from '@copilotkit/outpost/shared';
import { createJob, JobType } from '@copilotkit/outpost/queue';
import { extractTicketId, extractEmail, extractName } from './utils';
import type { PostmarkInboundPayload } from './utils';

export async function POST(request: Request) {
    // Opt-in webhook authentication via POSTMARK_WEBHOOK_TOKEN
    const webhookToken = process.env.POSTMARK_WEBHOOK_TOKEN;
    if (webhookToken) {
        const authHeader = request.headers.get('authorization');
        const expected = `Basic ${Buffer.from(webhookToken).toString('base64')}`;
        if (authHeader !== expected) {
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

                // Re-open ticket if it was resolved or closed
                if (existingTicket.status === 'RESOLVED' || existingTicket.status === 'CLOSED') {
                    await prisma.ticket.update({
                        where: { id: existingTicket.id },
                        data: { status: 'OPEN', updatedAt: new Date() },
                    });
                }

                // Enqueue AI response for the reply
                await createJob(JobType.AI_RESPONSE, { ticketId: existingTicket.id, source: 'web' });

                return NextResponse.json({ status: 'message_appended', ticketId: existingTicket.displayId });
            }
        }

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

        // Enqueue AI response for the new ticket
        await createJob(JobType.AI_RESPONSE, { ticketId: ticket.id, source: 'web' });

        return NextResponse.json({ status: 'ticket_created', ticketId: ticket.displayId });
    } catch (err) {
        console.error('[Postmark Webhook] Error processing inbound email:', err);
        return NextResponse.json(
            { error: 'Internal error processing email' },
            { status: 500 },
        );
    }
}
