/**
 * Reading and posting, over REST.
 *
 * A gateway connection is only needed to *receive* events (slash commands,
 * reactions). Posting needs nothing but the token, so this stays a scheduled job
 * until the bot has a reason to listen.
 */

import { TIMEOUT_MS, parseJson } from './http.js';

const API = 'https://discord.com/api/v10';

/** Discord's hard cap on a message. */
export const MESSAGE_LIMIT = 2000;

/** Pages of 100 messages to look back through for this bot's own announcements. */
const HISTORY_PAGES = 3;

const MAX_RETRIES = 3;

/** Ceiling on an honoured `retry_after`, so a global limit cannot park the run for an hour. */
const MAX_RETRY_WAIT_MS = 60_000;

function auth() {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) throw new Error('DISCORD_BOT_TOKEN is not set');
    return {
        Authorization: `Bot ${token}`,
        'User-Agent': 'DiscordBot (https://github.com/CopilotKit/outpost, 1.0)',
    };
}

let botIdPromise: Promise<string> | undefined;

function selfId(): Promise<string> {
    botIdPromise ??= (async () => {
        // Through request() so this read gets the same retries as the others; a
        // single 429 here used to fail whichever source reached it first.
        const res = await request('/users/@me', { method: 'GET' });
        if (!res.ok) throw new Error(`Discord ${res.status} reading own identity`);
        return (await parseJson<{ id: string }>(res, 'Discord')).id;
    })().catch((error) => {
        botIdPromise = undefined;
        throw error;
    });
    return botIdPromise;
}

type DiscordMessage = {
    id: string;
    timestamp?: string;
    author?: { id: string };
    content?: string;
};

export type Announced = {
    /** Source URLs this bot has already announced in the channel. */
    urls: Set<string>;
    /** False when no message from this bot was found in the pages searched. */
    foundOwn: boolean;
    /** Timestamp of the oldest message read, which bounds how far back we looked. */
    searchedFrom?: string;
};

/**
 * What this bot has already announced in a channel.
 *
 * The channel is the record, rather than a state file: nothing to commit,
 * nothing to migrate when the repo moves, and no way for the file and reality to
 * drift apart. Each announcement ends with its source URL, so that URL is the
 * identity we match on.
 *
 * Only that trailing URL counts. Discord's auto-generated preview embeds are
 * deliberately ignored: it unfurls every link in a message, including ones the
 * model wrote into the summary, and reading those back re-introduced the bug
 * `sourceUrlOf` exists to prevent.
 *
 * Paginating matters: with one page of 50, a channel where people actually talk
 * pushed the bot's last announcement out of the window, which read as "never
 * posted here" and re-announced the latest release.
 */
export async function announced(channelId: string): Promise<Announced> {
    const me = await selfId();
    const urls = new Set<string>();
    let foundOwn = false;
    let searchedFrom: string | undefined;
    let before: string | undefined;

    for (let page = 0; page < HISTORY_PAGES; page++) {
        const query = new URLSearchParams({ limit: '100' });
        if (before) query.set('before', before);

        const res = await request(`/channels/${channelId}/messages?${query}`, { method: 'GET' });

        if (res.status === 403) {
            throw new Error(
                `Discord 403 reading ${channelId}. The bot needs View Channel and Read Message History.`,
            );
        }
        if (!res.ok) throw new Error(`Discord ${res.status} reading ${channelId}`);

        const batch = await parseJson<DiscordMessage[]>(res, 'Discord');
        if (!batch.length) break;

        for (const message of batch) {
            if (message.author?.id !== me) continue;
            foundOwn = true;
            const trailing = sourceUrlOf(message.content ?? '');
            if (trailing) urls.add(trailing);
        }

        const oldest = batch[batch.length - 1];
        searchedFrom = oldest?.timestamp ?? searchedFrom;
        before = oldest?.id;
        if (batch.length < 100) break;
    }

    if (!foundOwn) {
        console.warn(
            `${channelId}: no messages from this bot in the last ${HISTORY_PAGES * 100}; ` +
                'treating the channel as new.',
        );
    }

    return { urls, foundOwn, searchedFrom };
}

/**
 * The source URL of an announcement, which is its last line.
 *
 * Only the trailing URL counts. Harvesting every link in the message swept up
 * URLs the model wrote into the summary, and a summary that mentioned another
 * release marked that release as already announced.
 */
export function sourceUrlOf(content: string): string | undefined {
    const lastLine = content.trimEnd().split('\n').pop() ?? '';
    const match = lastLine.trim().match(/^<?(https?:\/\/[^\s>]+)>?$/);
    return match?.[1];
}

export type Announcement = {
    channelId: string;
    /** Bold first line. */
    title: string;
    /** The summary. Trimmed if the message would not otherwise fit. */
    body: string;
    /** Credit line, kept whole. */
    footer?: string;
    /** Ends the message, and is the dedup identity, so it always survives. */
    url: string;
    /** Role id to ping. Omitted means the post is silent. */
    pingRoleId?: string;
};

/**
 * Assembles a message that fits Discord's limit with the source URL intact.
 *
 * The budget lives here rather than in the caller because the role mention is
 * added here: the caller used to budget to exactly 2000 characters, then this
 * function prepended a ~24-character mention and truncated the overflow off the
 * end, taking the trailing URL with it. A release whose URL was cut looked
 * unannounced forever and was re-posted on every run.
 */
export function compose({
    title,
    body,
    footer,
    url,
    pingRoleId,
}: Omit<Announcement, 'channelId'>): string {
    const prefix = pingRoleId ? `${withPing('', pingRoleId)}` : '';
    const urlPart = `\n\n${url}`;

    // Sacrifice order, most expendable first: the body, then the credit line,
    // then the title. The URL is never sacrificed, because losing it means the
    // announcement can never be recognised again and gets re-posted forever.
    const titleRoom = MESSAGE_LIMIT - prefix.length - urlPart.length - '****'.length;
    const shownTitle = title.length <= titleRoom ? title : truncate(title, titleRoom);
    const head = shownTitle ? `${prefix}**${shownTitle}**` : prefix.trimEnd();

    let left = MESSAGE_LIMIT - head.length - urlPart.length;

    const footerPart = footer ? `\n\n${footer}` : '';
    const keepFooter = footerPart.length > 0 && footerPart.length <= left;
    if (keepFooter) left -= footerPart.length;

    return head + section(body, left) + (keepFooter ? footerPart : '') + urlPart;
}

/** A `\n\n`-separated section, trimmed to what is left, or nothing if it cannot fit. */
function section(text: string, room: number): string {
    const available = room - '\n\n'.length;
    if (!text || available <= 1) return '';
    return `\n\n${text.length <= available ? text : truncate(text, available)}`;
}

/** Trims to `max` characters including the ellipsis, without splitting a surrogate pair. */
function truncate(text: string, max: number): string {
    if (max <= 1) return '';
    let end = max - 1;
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1; // don't leave a lone high surrogate
    return `${text.slice(0, end).trimEnd()}…`;
}

export async function announce(announcement: Announcement) {
    const content = compose(announcement);
    await send(announcement.channelId, content, announcement.pingRoleId);
}

/** A plain message. Used for videos, where Discord's own unfurl is the preview. */
export async function postText(channelId: string, content: string, pingRoleId?: string) {
    await send(channelId, withPing(content, pingRoleId), pingRoleId);
}

/**
 * The role mention, in one place.
 *
 * Two sites used to build this independently, and the mention being applied
 * outside a caller's character budget is what sheared the trailing URL off
 * announcements.
 */
export function withPing(content: string, pingRoleId?: string): string {
    return pingRoleId ? `<@&${pingRoleId}> ${content}` : content;
}

/** A stable per-message id, so the same content cannot post twice in a run. */
function nonceFor(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) hash = (hash * 31 + content.charCodeAt(i)) | 0;
    return `rb-${(hash >>> 0).toString(36)}`;
}

async function send(channelId: string, content: string, pingRoleId?: string) {
    // A message over the limit would be truncated from the end, which is where
    // the dedup URL lives. Refusing is safer than posting an announcement that
    // can never be recognised again.
    if (content.length > MESSAGE_LIMIT) {
        throw new Error(
            `Message for ${channelId} is ${content.length} characters, over Discord's ${MESSAGE_LIMIT}.`,
        );
    }

    const res = await request(`/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            // Discord de-duplicates by nonce for a short window, which covers a
            // retry that lands after the message was already created.
            nonce: nonceFor(content),
            content,
            // `parse: []` on both paths. The body is model-written text derived
            // from release notes, so an @everyone in a summary must be
            // structurally impossible rather than left to an API default.
            allowed_mentions: { parse: [], roles: pingRoleId ? [pingRoleId] : [] },
        }),
    });

    if (!res.ok) {
        throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
}

/**
 * One request, with bounded retries.
 *
 * Reads are retried as well as writes: a rate limit while reading the channel
 * used to abort the whole run, taking the other sources with it.
 *
 * What is retried differs by method. A 429 is safe everywhere, because a
 * rate-limited request never executed. A 5xx is only retried on reads: Discord
 * can accept a message and then fail the response, so retrying a POST risks
 * announcing the same release twice, which is worse than failing the run.
 * Thrown errors (timeout, reset) follow the same rule.
 */
async function request(path: string, init: RequestInit): Promise<Response> {
    const isRead = (init.method ?? 'GET') === 'GET';

    for (let attempt = 1; ; attempt++) {
        const last = attempt >= MAX_RETRIES;

        let res: Response;
        try {
            res = await fetch(`${API}${path}`, {
                ...init,
                headers: { ...auth(), ...(init.headers ?? {}) },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (error) {
            if (last || !isRead) throw error;
            await pause(backoff(attempt));
            continue;
        }

        const retryable = res.status === 429 || (isRead && res.status >= 500);
        if (!retryable || last) return res;

        await pause(await retryDelay(res, attempt));
    }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const backoff = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), MAX_RETRY_WAIT_MS);

/**
 * How long to wait before retrying.
 *
 * The header is read first because a Cloudflare-level 429 returns HTML, and
 * parsing that body as JSON threw a SyntaxError that surfaced as
 * "Unexpected token '<'" with nothing to say it was a rate limit.
 */
async function retryDelay(res: Response, attempt: number): Promise<number> {
    const header = Number(res.headers.get('retry-after'));
    if (Number.isFinite(header) && header > 0) {
        return Math.min(header * 1000 + 100, MAX_RETRY_WAIT_MS);
    }

    const body = await res.text().catch(() => '');
    try {
        const parsed = JSON.parse(body) as { retry_after?: number };
        if (typeof parsed.retry_after === 'number') {
            return Math.min(parsed.retry_after * 1000 + 100, MAX_RETRY_WAIT_MS);
        }
    } catch {
        // Not JSON, which is itself the signal that this is an edge rate limit.
    }

    return backoff(attempt);
}
