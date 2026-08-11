/**
 * InboundHandler — the shared code path all bots call after normalizing
 * a raw platform event into an InboundMessage.
 *
 * Handles:
 * 1. New tickets (isThreadStart=true): create Ticket + first Message + enqueue AI_RESPONSE
 * 2. Replies (isThreadStart=false): find existing ticket, create Message, reopen if needed.
 *    Never enqueues AI_RESPONSE — Outpost answers once per ticket, on the opening
 *    message only, and a human owns the thread after that.
 * 3. Team member detection via ExternalIdentity -> TeamMember lookup
 * 4. Sequential display ID generation (TKT-XXXXXXXX)
 */

import type { InboundMessage, InboundResult, TicketRef } from './types.js';
import { generateTicketId, truncate } from '../utils.js';
import { reopensOnCustomerReply } from '../constants.js';
import { TicketSource } from '../types.js';

/**
 * Prisma client interface — the subset of PrismaClient we actually call.
 * Allows dependency injection for testing without importing the full client.
 */
export interface PrismaLike {
    ticket: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: (args: any) => Promise<{ id: string; displayId: string; status: string; sourceId: string | null; channel: string | null; source: string }>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findFirst: (args: any) => Promise<{ id: string; displayId: string; status: string; sourceId: string | null; channel: string | null; source: string } | null>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: (args: any) => Promise<{ id: string; displayId: string; status: string }>;
    };
    message: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: (args: any) => Promise<{ id: string }>;
    };
    user: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findFirst: (args: any) => Promise<{ id: string; email: string | null } | null>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: (args: any) => Promise<{ id: string }>;
    };
    teamMember: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findUnique: (args: any) => Promise<{ id: string } | null>;
    };
    ticketExternalLink: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: (args: any) => Promise<{ id: string }>;
    };
}

/**
 * Job creation function interface — matches createJob signature.
 */
export type CreateJobFn = (
    type: string,
    payload: { ticketId: string; threadId?: string; source: string },
) => Promise<string>;

/**
 * Detect a Prisma unique-constraint violation (P2002) without importing the
 * Prisma runtime here — inbound.ts stays decoupled behind PrismaLike, so we
 * duck-type the error code.
 */
function isUniqueConstraintError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: unknown }).code === 'P2002'
    );
}

/**
 * Map TicketSource to PlatformTarget for job payloads.
 */
function toPlatformTarget(source: TicketSource): string {
    switch (source) {
        case TicketSource.DISCORD: return 'discord';
        case TicketSource.GITHUB_ISSUE: return 'github';
        case TicketSource.GITHUB_DISCUSSION: return 'github';
        case TicketSource.SLACK: return 'slack';
        case TicketSource.TEAMS: return 'teams';
        case TicketSource.EMAIL: return 'web';
        default: return 'web';
    }
}

/**
 * Configuration for the InboundHandler.
 */
export interface InboundHandlerConfig {
    /** Prisma client (or mock) for database operations */
    prisma: PrismaLike;
    /** Job creation function for enqueueing AI_RESPONSE jobs */
    createJob: CreateJobFn;
    /** Job type string for AI_RESPONSE (default: 'AI_RESPONSE') */
    aiResponseJobType?: string;
}

/**
 * The InboundHandler processes normalized messages from any platform.
 *
 * Usage:
 * ```
 * const handler = new InboundHandler({ prisma, createJob });
 * const result = await handler.handle(inboundMessage);
 * ```
 */
export class InboundHandler {
    private readonly prisma: PrismaLike;
    private readonly createJob: CreateJobFn;
    private readonly aiResponseJobType: string;

    constructor(config: InboundHandlerConfig) {
        this.prisma = config.prisma;
        this.createJob = config.createJob;
        this.aiResponseJobType = config.aiResponseJobType ?? 'AI_RESPONSE';
    }

    /**
     * Process an inbound message.
     *
     * Determines whether this is a new ticket or a reply to an existing one,
     * creates the appropriate database records, and enqueues an AI_RESPONSE
     * job if the sender is not a team member.
     */
    async handle(message: InboundMessage): Promise<InboundResult> {
        if (message.isThreadStart) {
            return this.handleNewTicket(message);
        }
        return this.handleReply(message);
    }

    /**
     * Create a new ticket from a thread-start message.
     */
    private async handleNewTicket(message: InboundMessage): Promise<InboundResult> {
        const displayId = generateTicketId();
        const authorLabel = `${message.platformUsername} (${message.platformUserId})`;

        // Build sourceId — Slack uses a composite "channelId:threadTs" key
        // so that reply lookups match the same format.
        let sourceId = message.threadId ?? null;
        if (message.source === TicketSource.SLACK && message.channelId && message.threadId) {
            sourceId = `${message.channelId}:${message.threadId}`;
        }

        // Find-or-create the User row for the message sender so the ticket
        // can be linked to them (needed for reporter-identity lookups like
        // the GitHub reaction poll's ticket.user?.externalId check).
        const userId = await this.findOrCreateUser(
            message.platformUserId,
            message.platformUsername,
            message.source,
        );

        // Create the ticket
        const ticket = await this.prisma.ticket.create({
            data: {
                displayId,
                title: truncate(message.content, 200),
                description: truncate(message.content, 4000),
                status: 'OPEN',
                priority: 'MEDIUM',
                type: 'QUESTION',
                source: message.source,
                sourceId,
                sourceUrl: message.sourceUrl ?? null,
                channel: message.channelId ?? null,
                userId,
            },
        });

        // Create the first Message record
        let messageId: string | null = null;
        if (message.content) {
            const msg = await this.prisma.message.create({
                data: {
                    ticketId: ticket.id,
                    author: authorLabel,
                    content: truncate(message.content, 8000),
                    type: 'USER',
                    attachments: message.attachments ? JSON.parse(JSON.stringify(message.attachments)) : undefined,
                },
            });
            messageId = msg.id;
        }

        // Check if sender is a team member — they still get a ticket but skip AI
        const isTeam = await this.isTeamMember(message.platformUserId, message.source);

        let aiJobEnqueued = false;
        if (!isTeam) {
            await this.createJob(this.aiResponseJobType, {
                ticketId: ticket.id,
                threadId: message.threadId,
                source: toPlatformTarget(message.source),
            });
            aiJobEnqueued = true;
        }

        return {
            ticketId: ticket.id,
            displayId,
            isNewTicket: true,
            aiJobEnqueued,
            messageId,
        };
    }

    /**
     * Handle a reply to an existing ticket thread.
     */
    private async handleReply(message: InboundMessage): Promise<InboundResult> {
        // Look up the existing ticket by source + threadId
        const ticket = await this.findTicketBySourceAndThread(
            message.source,
            message.threadId ?? '',
            message.channelId,
        );

        if (!ticket) {
            // No existing ticket found for this thread — treat as a new ticket.
            // This handles edge cases where a reply arrives before the thread-start
            // event, or the original ticket was deleted.
            return this.handleNewTicket({ ...message, isThreadStart: true });
        }

        const authorLabel = `${message.platformUsername} (${message.platformUserId})`;

        // Append the message
        const msg = await this.prisma.message.create({
            data: {
                ticketId: ticket.id,
                author: authorLabel,
                content: truncate(message.content, 8000),
                type: 'USER',
                attachments: message.attachments ? JSON.parse(JSON.stringify(message.attachments)) : undefined,
            },
        });

        // NO AI RESPONSE ON REPLIES — deliberate, not an omission.
        //
        // Outpost answers the message that opens a ticket and nothing after it.
        // Replies only move ticket state; the thread belongs to a human from
        // the first response onward. This used to enqueue an AI_RESPONSE for
        // every non-team sender, which meant the bot chimed in on follow-up
        // questions between community members and even summarised a human's
        // answer back at them.
        //
        // The invariant is also enforced in the AI_RESPONSE handler
        // (packages/outpost/queue/src/handlers/ai-response.ts) against the
        // ticket's own message history. Not enqueuing here is the cheap arm —
        // it avoids paying for a job that would be dropped on arrival.
        const isTeam = await this.isTeamMember(message.platformUserId, message.source);

        if (isTeam) {
            // Team member replied: if ticket was WAITING_ON_TEAM, move to WAITING_ON_CUSTOMER
            if (ticket.status === 'WAITING_ON_TEAM') {
                await this.prisma.ticket.update({
                    where: { id: ticket.id },
                    data: { status: 'WAITING_ON_CUSTOMER' },
                });
            }
        } else if (reopensOnCustomerReply(ticket.status)) {
            // Customer/external reply reopens a dormant ticket so a human sees it.
            await this.prisma.ticket.update({
                where: { id: ticket.id },
                data: { status: 'OPEN' },
            });
        }

        return {
            ticketId: ticket.id,
            displayId: ticket.displayId,
            isNewTicket: false,
            aiJobEnqueued: false,
            messageId: msg.id,
        };
    }

    /**
     * Find an existing ticket by its source platform and thread/conversation ID.
     *
     * For Slack, the sourceId is "channelId:threadTs" so we use channelId
     * to reconstruct the composite key. For other platforms, sourceId is
     * the threadId directly.
     */
    private async findTicketBySourceAndThread(
        source: TicketSource,
        threadId: string,
        channelId?: string,
    ): Promise<TicketRef | null> {
        let sourceId = threadId;

        // Slack uses a composite sourceId: "channelId:threadTs"
        if (source === TicketSource.SLACK && channelId) {
            sourceId = `${channelId}:${threadId}`;
        }

        const ticket = await this.prisma.ticket.findFirst({
            where: {
                source: source as string,
                sourceId,
            },
        });

        if (!ticket) return null;

        return {
            id: ticket.id,
            displayId: ticket.displayId,
            status: ticket.status,
            sourceId: ticket.sourceId,
            channel: ticket.channel,
            source: ticket.source as TicketSource,
        };
    }

    /**
     * Find or create the User row for a platform sender, so the ticket
     * created from their message can be linked via `ticket.userId`.
     *
     * Reuses the exact same lookup pattern `isTeamMember` uses ({ externalId,
     * source }) so a real team-member User row created elsewhere (with a
     * real email) is found and reused, never duplicated. If no User exists
     * yet, creates one with a synthesized placeholder email — GitHub/Discord
     * webhook payloads don't reliably include a real email for the sender,
     * but `User.email` is a required unique column.
     */
    private async findOrCreateUser(
        platformUserId: string,
        platformUsername: string,
        source: TicketSource,
    ): Promise<string> {
        const userSource = source as string;

        const existing = await this.prisma.user.findFirst({
            where: {
                externalId: platformUserId,
                source: userSource,
            },
        });

        if (existing) return existing.id;

        const placeholderEmail = `${source.toLowerCase()}-${platformUserId}@reporters.outpost.internal`;

        try {
            const created = await this.prisma.user.create({
                data: {
                    name: platformUsername,
                    email: placeholderEmail,
                    externalId: platformUserId,
                    source: userSource,
                },
            });
            return created.id;
        } catch (err) {
            // Concurrent-create race: another inbound message from the same
            // sender created this User between our findFirst and create, and
            // hit the unique email constraint first. Re-read and reuse it
            // rather than throwing — dropping a customer's ticket is worse.
            if (isUniqueConstraintError(err)) {
                const raced = await this.prisma.user.findFirst({
                    where: { externalId: platformUserId, source: userSource },
                });
                if (raced) return raced.id;
            }
            throw err;
        }
    }

    /**
     * Determine if a platform user is a team member.
     *
     * Uses the ExternalIdentity -> TeamMember lookup pattern established
     * by the existing bot implementations:
     * 1. Find a User with matching externalId and source
     * 2. If found, look up a TeamMember with the same email
     *
     * This is a unified version of the per-bot isTeamMember functions.
     */
    private async isTeamMember(
        platformUserId: string,
        source: TicketSource,
    ): Promise<boolean> {
        // Map TicketSource to the source values used in the User table.
        // GitHub issues and discussions both store users with their respective sources.
        const userSource = source as string;

        const user = await this.prisma.user.findFirst({
            where: {
                externalId: platformUserId,
                source: userSource,
            },
        });

        if (!user?.email) return false;

        const member = await this.prisma.teamMember.findUnique({
            where: { email: user.email },
        });

        return member !== null;
    }
}
