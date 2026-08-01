/**
 * Slack ticket mirror job handler.
 *
 * Mirrors every ticket from GitHub and Discord into one internal Slack channel:
 * the ticket opens a thread, and community follow-ups plus the AI's reply post
 * as threaded replies underneath it. One Slack thread is the whole life of one
 * ticket.
 *
 * Read-only in v1 — replying inside Slack does not post back to the source.
 * Thread identity lives in TicketExternalLink (plugin `slack`, externalId
 * `channelId:ts`), reusing the same table the Linear and GitHub links use.
 */

import { WebClient } from '@slack/web-api';
import { prisma } from '@copilotkit/outpost/db';
import {
    readSlackMirrorConfig,
    isSlackMirrorEnabled,
    buildPermalink,
    type SlackMirrorConfig,
} from '@copilotkit/outpost/shared/platforms';
import type { SlackMirrorPayload, JobResult, JobHandlerContext } from '../types.js';

/** TicketExternalLink.plugin value owned by the mirror. */
export const SLACK_MIRROR_PLUGIN = 'slack';

/** Slack hard-caps a single text block; leave room for our framing. */
const MAX_MIRROR_TEXT = 2800;

/** Minimal Slack surface the handler needs — lets tests inject a fake. */
export interface SlackPoster {
    postMessage(args: {
        channel: string;
        text: string;
        thread_ts?: string;
    }): Promise<{ ts?: string }>;
}

export interface SlackMirrorDeps {
    prisma: typeof prisma;
    config: SlackMirrorConfig;
    /** Omit to build a real WebClient from the config token. */
    poster?: SlackPoster;
}

function truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1)}…`;
}

function buildPoster(config: SlackMirrorConfig): SlackPoster {
    if (!config.token) {
        throw new Error(
            'SLACK_BOT_TOKEN is required to post the ticket mirror. It must be set on the ' +
                'worker service (the mirror runs there, not in the Slack bot) and carry chat:write.',
        );
    }
    const client = new WebClient(config.token);
    return {
        async postMessage(args) {
            const result = await client.chat.postMessage(args);
            return { ts: result.ts as string | undefined };
        },
    };
}

/** Thread-opening post: what the ticket is, who reported it, where it came from. */
function formatTicketPost(ticket: {
    displayId: string;
    title: string;
    source: string;
    sourceUrl: string | null;
    description: string | null;
}): string {
    const header = `*[${ticket.displayId}] ${truncate(ticket.title, 200)}*`;
    const origin = ticket.sourceUrl
        ? `${ticket.source} · <${ticket.sourceUrl}|view original>`
        : String(ticket.source);
    const body = ticket.description ? truncate(ticket.description, MAX_MIRROR_TEXT) : '_no body_';
    return `${header}\n${origin}\n\n${body}`;
}

/**
 * Threaded reply post.
 *
 * An AI message that was withheld or shadow-logged is labelled as such. The
 * mirror must not imply the reporter saw something they never saw — that is
 * exactly the divergence #148 describes between what the DB records and what
 * was actually published.
 */
function formatReplyPost(
    message: { author: string; content: string; isAiGenerated: boolean },
    delivered: boolean | undefined,
): string {
    const who = message.isAiGenerated ? `🤖 ${message.author}` : message.author;
    const undelivered =
        message.isAiGenerated && delivered === false
            ? '\n_⚠️ not delivered to the reporter — withheld or shadow mode_'
            : '';
    return `*${who}*${undelivered}\n${truncate(message.content, MAX_MIRROR_TEXT)}`;
}

/**
 * Handle a SLACK_MIRROR job.
 *
 * Ordering note: a `reply` whose thread does not exist yet opens the thread
 * first. Jobs can land out of order, and the mirror can be switched on partway
 * through a live conversation; neither should drop messages on the floor.
 */
export async function handleSlackMirror(
    payload: SlackMirrorPayload,
    context: JobHandlerContext,
    deps?: Partial<SlackMirrorDeps>,
): Promise<JobResult> {
    const db = deps?.prisma ?? prisma;
    const config = deps?.config ?? readSlackMirrorConfig();

    if (!isSlackMirrorEnabled(config)) {
        return { success: true, data: { skipped: 'mirror-disabled' } };
    }
    // isSlackMirrorEnabled guarantees this, but the compiler does not know it.
    const channelId = config.channelId!;

    await context.reportProgress(10);

    const ticket = await db.ticket.findUnique({ where: { id: payload.ticketId } });
    if (!ticket) {
        return { success: false, error: `Ticket ${payload.ticketId} not found` };
    }

    const existingLink = await db.ticketExternalLink.findUnique({
        where: { ticketId_plugin: { ticketId: ticket.id, plugin: SLACK_MIRROR_PLUGIN } },
    });

    // Already mirrored — opening a second thread for the same ticket would
    // split its history across two places.
    if (payload.kind === 'ticket' && existingLink) {
        return { success: true, data: { skipped: 'already-mirrored' } };
    }

    const isShadow = config.mode === 'shadow';
    const poster = isShadow ? null : (deps?.poster ?? buildPoster(config));

    await context.reportProgress(40);

    // ── Open the thread when it does not exist yet ───────────────────────────
    let threadTs = existingLink ? parseThreadTs(existingLink.externalId) : null;

    if (!threadTs) {
        const text = formatTicketPost(ticket);
        if (isShadow) {
            console.log(
                `[Slack Mirror] shadow — would open thread in ${channelId} for ${ticket.displayId}:\n${text}`,
            );
        } else {
            const result = await poster!.postMessage({ channel: channelId, text });
            if (!result.ts) {
                return {
                    success: false,
                    error: `Slack accepted the mirror post for ${ticket.displayId} but returned no ts`,
                };
            }
            threadTs = result.ts;
            await db.ticketExternalLink.create({
                data: {
                    ticketId: ticket.id,
                    plugin: SLACK_MIRROR_PLUGIN,
                    externalId: `${channelId}:${threadTs}`,
                    externalUrl: buildPermalink(channelId, threadTs),
                },
            });
        }
    }

    await context.reportProgress(70);

    // ── Post the reply underneath it ─────────────────────────────────────────
    if (payload.kind === 'reply') {
        if (!payload.messageId) {
            return { success: false, error: 'SLACK_MIRROR reply job carried no messageId' };
        }

        const message = await db.message.findUnique({ where: { id: payload.messageId } });
        if (!message) {
            return { success: false, error: `Message ${payload.messageId} not found` };
        }

        const text = formatReplyPost(message, payload.delivered);
        if (isShadow) {
            console.log(
                `[Slack Mirror] shadow — would reply in ${channelId} on ${ticket.displayId}:\n${text}`,
            );
        } else {
            await poster!.postMessage({ channel: channelId, text, thread_ts: threadTs! });
        }
    }

    await context.reportProgress(100);

    return {
        success: true,
        data: { mode: config.mode, kind: payload.kind, ticketId: ticket.id },
    };
}

/** externalId is stored as `channelId:ts`; the ts is everything after the colon. */
function parseThreadTs(externalId: string): string | null {
    const idx = externalId.indexOf(':');
    if (idx === -1) return null;
    return externalId.slice(idx + 1) || null;
}
