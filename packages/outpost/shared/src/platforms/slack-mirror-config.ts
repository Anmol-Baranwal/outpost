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
 */
export function isSlackMirrorEnabled(config: SlackMirrorConfig): boolean {
    if (config.mode === 'off') return false;
    return config.channelId !== null;
}
