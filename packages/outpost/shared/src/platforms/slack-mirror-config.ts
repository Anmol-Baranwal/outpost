/**
 * Configuration for the Slack ticket mirror.
 *
 * The mirror posts every ticket from GitHub and Discord into one internal Slack
 * channel, with follow-ups threaded underneath, so a single Slack thread is the
 * whole life of one ticket.
 *
 * `SLACK_MIRROR_MODE` is deliberately INDEPENDENT of `SHADOW_MODE`. That flag
 * protects community surfaces (Discord, GitHub) where real reporters are
 * watching; the mirror targets an internal team channel, so posting there from
 * staging is intended rather than a violation of the standing shadow-mode rule.
 * The mirror's own three-way flag is what keeps it inert until it is configured.
 */

/** `off` no-ops · `shadow` logs what it would post · `live` posts to Slack. */
export type SlackMirrorMode = 'off' | 'shadow' | 'live';

export interface SlackMirrorConfig {
    mode: SlackMirrorMode;
    /** Slack channel ID (e.g. C09AB2CD3EF) — an ID, never a channel name. */
    channelId: string | null;
    /** Bot token; must carry chat:write and be set on the worker service. */
    token: string | null;
}

/**
 * Read the mirror configuration from the environment.
 *
 * Unset or unrecognized `SLACK_MIRROR_MODE` resolves to `off`: the feature
 * ships inert, and a typo fails closed rather than posting unexpectedly.
 */
export function readSlackMirrorConfig(env: NodeJS.ProcessEnv = process.env): SlackMirrorConfig {
    const raw = (env.SLACK_MIRROR_MODE ?? 'off').trim().toLowerCase();
    const mode: SlackMirrorMode = raw === 'live' || raw === 'shadow' ? raw : 'off';

    return {
        mode,
        channelId: env.SLACK_MIRROR_CHANNEL_ID?.trim() || null,
        token: env.SLACK_BOT_TOKEN?.trim() || null,
    };
}

/**
 * Whether the mirror should do anything at all for this process.
 *
 * Used by the producers (inbound handler, AI response handler) so a disabled
 * mirror never enqueues jobs, and by the consumer as its first check.
 *
 * `shadow` counts as enabled — it exists to be exercised, and its whole value
 * is producing log lines showing what a live run would post. Only the channel
 * ID is required for that, not the token.
 *
 * `live` additionally requires a token. Without one, every job would reach the
 * poster, throw, and burn its retries into the dead-letter queue — one per
 * ticket, indefinitely. A misconfigured `live` therefore reads as DISABLED
 * (nothing is enqueued, nothing dies) and says so once, loudly, because the
 * operator's intent was to post and silence would hide that it never did.
 */
export function isSlackMirrorEnabled(config: SlackMirrorConfig): boolean {
    if (config.mode === 'off') return false;
    if (config.channelId === null) return false;
    if (config.mode === 'live' && config.token === null) {
        warnLiveWithoutToken();
        return false;
    }
    return true;
}

/** Latch so the misconfiguration is reported once per process, not per job. */
let liveWithoutTokenWarned = false;

function warnLiveWithoutToken(): void {
    if (liveWithoutTokenWarned) return;
    liveWithoutTokenWarned = true;
    console.error(
        '[Slack Mirror] SLACK_MIRROR_MODE=live but SLACK_BOT_TOKEN is unset — the mirror is ' +
            'DISABLED. Set SLACK_BOT_TOKEN (needs chat:write) on this service; the mirror handler ' +
            'runs in outpost-worker, so the worker needs it too, not only outpost-slack-bot.',
    );
}

/** Test seam: reset the once-per-process warning latch. */
export function resetSlackMirrorWarnings(): void {
    liveWithoutTokenWarned = false;
}

/**
 * Ticket sources the mirror covers.
 *
 * An ALLOWLIST, deliberately. The mirror exists to bring GitHub and Discord
 * tickets into Slack; a denylist ("everything except SLACK") silently pulled in
 * TEAMS, EMAIL, WEB, MANUAL, and LINEAR tickets the feature was never specified
 * for. Slack-sourced tickets are excluded because they already live in Slack.
 *
 * Values are the string forms of `TicketSource` (shared/src/types.ts). This
 * module deliberately does not import that enum: it is consumed by both the
 * queue package and the platform producers, and staying string-keyed keeps it
 * free of a cycle through the platform barrel.
 */
const MIRRORABLE_SOURCES: ReadonlySet<string> = new Set([
    'DISCORD',
    'GITHUB_ISSUE',
    'GITHUB_DISCUSSION',
]);

/**
 * Whether a ticket from this source should be mirrored.
 *
 * Both producers MUST route through this. The rule previously lived in the
 * inbound producer only, so the AI-reply producer mirrored everything — which
 * is how a Slack-sourced ticket ended up opening a thread in the mirror channel.
 */
export function isMirrorableSource(source: string): boolean {
    return MIRRORABLE_SOURCES.has(source);
}
