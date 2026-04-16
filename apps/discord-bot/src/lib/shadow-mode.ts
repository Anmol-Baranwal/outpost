import { prisma } from '@copilotkit/outpost-db';
import { createJob, JobType } from '@copilotkit/outpost-queue';
import { truncate } from '@copilotkit/outpost-shared';
import type { ThreadChannel, Message } from 'discord.js';

/**
 * Shadow mode allows Outpost to run alongside Orca without double-posting.
 *
 * When SHADOW_MODE=true:
 *   - Tickets are created in the Outpost DB as normal
 *   - AI responses are generated but NOT posted to Discord
 *   - Shadow responses are logged for quality comparison against Orca
 *
 * This enables a parallel-run validation period before full cutover.
 */
export function isShadowMode(): boolean {
    return process.env.SHADOW_MODE === 'true';
}

export interface ShadowResponse {
    ticketId: string;
    threadId: string;
    generatedContent: string;
    generatedAt: Date;
    responseTimeMs: number;
}

/**
 * Log a shadow response for later quality comparison.
 * Stored as a NOTE-type message on the ticket with metadata in attachments.
 */
export async function logShadowResponse(response: ShadowResponse): Promise<void> {
    await prisma.message.create({
        data: {
            ticketId: response.ticketId,
            author: 'outpost-shadow',
            content: truncate(response.generatedContent, 8000),
            type: 'SYSTEM',
            isAiGenerated: true,
            attachments: {
                // shadowMode flag handled at the job handler level via env var
                threadId: response.threadId,
                responseTimeMs: response.responseTimeMs,
                generatedAt: response.generatedAt.toISOString(),
            },
        },
    });

    console.log(
        `[Shadow Mode] Logged response for ticket ${response.ticketId} ` +
        `(${response.responseTimeMs}ms)`,
    );
}

/**
 * In shadow mode, create the ticket but skip the Discord acknowledgment.
 * Returns the created ticket ID, or null if creation failed.
 */
export async function handleShadowThreadCreate(
    thread: ThreadChannel,
    displayId: string,
    content: string,
    authorTag: string,
    authorId: string,
): Promise<string | null> {
    try {
        const ticket = await prisma.ticket.create({
            data: {
                displayId,
                title: truncate(thread.name, 200),
                description: truncate(content, 4000),
                status: 'OPEN',
                priority: 'MEDIUM',
                type: 'QUESTION',
                source: 'DISCORD',
                sourceId: thread.id,
                sourceUrl: thread.url,
                channel: thread.parentId ?? undefined,
            },
        });

        // Create the first message record if there's content
        if (content) {
            await prisma.message.create({
                data: {
                    ticketId: ticket.id,
                    author: `${authorTag} (${authorId})`,
                    content: truncate(content, 8000),
                    type: 'USER',
                },
            });
        }

        // Enqueue AI response — the worker should check shadow mode
        // and call logShadowResponse instead of posting to Discord
        await createJob(JobType.AI_RESPONSE, {
            ticketId: ticket.id,
            threadId: thread.id,
            source: 'discord' as const,
            // shadowMode flag handled at the job handler level via env var
        });

        console.log(
            `[Shadow Mode] Created ticket ${displayId} for thread ${thread.id} (no Discord post)`,
        );

        return ticket.id;
    } catch (error) {
        console.error(
            `[Shadow Mode] Failed to create ticket for thread ${thread.id}:`,
            error,
        );
        return null;
    }
}

/**
 * In shadow mode, record the message but don't trigger a visible AI response.
 */
export async function handleShadowMessage(
    message: Message,
    ticketId: string,
    threadId: string,
): Promise<void> {
    try {
        await prisma.message.create({
            data: {
                ticketId,
                author: `${message.author.tag} (${message.author.id})`,
                content: truncate(message.content, 8000),
                type: 'USER',
            },
        });

        // Enqueue AI response (shadow mode checked at handler level via SHADOW_MODE env)
        await createJob(JobType.AI_RESPONSE, {
            ticketId,
            threadId,
            source: 'discord' as const,
        });

        console.log(
            `[Shadow Mode] Recorded message from ${message.author.tag} on ticket ${ticketId}`,
        );
    } catch (error) {
        console.error(
            `[Shadow Mode] Failed to record message from ${message.author.tag} on ticket ${ticketId}:`,
            error,
        );
    }
}
