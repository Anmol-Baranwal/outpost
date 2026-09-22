/**
 * What this bot watches.
 *
 * This file is the whole configuration surface. To add a repository, add an
 * entry below and a channel id to the environment. Nothing else needs touching.
 *
 * Channel ids live in the environment because they differ per server and per
 * deployment. Tag filters live here because they are decisions about what is
 * worth announcing, not deployment settings, and they need a reason written
 * next to them.
 *
 * Several sources can share a channel. CopilotKit and OpenBot both post to the
 * CopilotKit community's releases channel, which is why each source names the
 * product in its title rather than leaning on the channel to say it.
 */

import type { Release } from './github.js';

export type Source = {
    /** Used in log lines. */
    name: string;
    /** `owner/repo` on github.com. Must be public. */
    repo: string;
    /** Where announcements go. Unset means this source is skipped entirely. */
    channelId: string | undefined;
    /** Role to ping. Unset means the announcement is silent. */
    pingRoleId?: string;
    /** Which tags are worth announcing. Keeps per-package noise out of the channel. */
    include: (tag: string) => boolean;
    /**
     * The announcement's first line. Names the product, because a bare `v0.0.15`
     * says nothing in a channel carrying more than one of them.
     */
    title: (release: Release) => string;
};

/** `channels/v0.10.0` -> `0.10.0`, `v1.73.0` -> `1.73.0`. */
const version = (tag: string) => tag.replace(/^.*\/v?|^v/, '');

/** Semver on the main line: `v1.73.0`, `v0.0.15`. */
const MAIN_LINE = /^v\d+\.\d+\.\d+$/;

export const SOURCES: Source[] = [
    {
        name: 'ag-ui',
        repo: 'ag-ui-protocol/ag-ui',
        channelId: process.env.AGUI_CHANNEL_ID,
        pingRoleId: process.env.AGUI_PING_ROLE_ID,
        // A day's package publishes are aggregated into one dated release. The
        // shape is asserted rather than assumed, so a visual-QA or test tag
        // cannot reach the channel.
        include: (tag) => /^release\/\d{4}-\d{2}-\d{2}$/.test(tag),
        title: (release) => `AG-UI ${release.tag.replace('release/', '')}`,
    },
    {
        name: 'copilotkit',
        repo: 'CopilotKit/CopilotKit',
        channelId: process.env.CPK_CHANNEL_ID,
        pingRoleId: process.env.CPK_PING_ROLE_ID,
        // One repo, several release lines. Announced are the ones that are both
        // a product people install and still shipping:
        //
        //   vX.Y.Z      the main line
        //   channels/   the Channels SDK
        //   angular/    the Angular SDK
        //
        // Skipped, and why:
        //
        //   intelligence-*/    version alignment; intelligence-mastra/v1.71.2's
        //                      notes say the API and implementation are unchanged
        //   channels-teams/    and the other per-adapter lines, all last released
        //                      2026-07-10 and superseded by channels/
        //   bot*/              last released 2026-06-25, now its own repo
        //   python-sdk/        active, but the notes are only a PyPI link
        //   pr-*, vundefined   preview and junk tags
        include: (tag) => MAIN_LINE.test(tag) || /^(channels|angular)\/v\d+\.\d+\.\d+$/.test(tag),
        title: (release) => {
            if (release.tag.startsWith('channels/')) return `Channels SDK ${version(release.tag)}`;
            if (release.tag.startsWith('angular/')) return `Angular SDK ${version(release.tag)}`;
            return `CopilotKit ${version(release.tag)}`;
        },
    },
    {
        name: 'openbot',
        repo: 'CopilotKit/OpenBot',
        // Shares the CopilotKit community's releases channel unless given one of
        // its own. Two sources in one channel can each post MAX_PER_RUN.
        channelId: process.env.OPENBOT_CHANNEL_ID || process.env.CPK_CHANNEL_ID,
        pingRoleId: process.env.OPENBOT_PING_ROLE_ID || process.env.CPK_PING_ROLE_ID,
        include: (tag) => MAIN_LINE.test(tag),
        title: (release) => `OpenBot ${version(release.tag)}`,
    },
];
