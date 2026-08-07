/**
 * Which plugins can actually receive outbound sync.
 *
 * A plugin belongs here only once `initializeSyncEngine()` registers an
 * internal tracker for it. Anything that enqueues TRACKER_SYNC work must gate
 * on this list: the engine rejects an unregistered plugin with
 * `Plugin "<name>" is not registered` (engine.ts), and because that rejection
 * happens inside the job handler rather than at the API boundary, every such
 * job burns its retries and lands in the DLQ. Failing at the caller turns a
 * silent queue flood into an immediate, explainable error.
 *
 * GitHub is deliberately absent. The GitHub adapter exists, but constructing it
 * needs an authenticated Octokit that today only lives inside apps/github-app,
 * so the worker's engine has no `github` tracker registered — see #98. Add
 * 'github' here in the same change that registers the adapter, not before.
 */
export const OUTBOUND_SYNC_PLUGINS = ['linear'] as const;

export type OutboundSyncPlugin = (typeof OUTBOUND_SYNC_PLUGINS)[number];

/** True when `plugin` has a registered outbound adapter. */
export function supportsOutboundSync(plugin: string): plugin is OutboundSyncPlugin {
    return (OUTBOUND_SYNC_PLUGINS as readonly string[]).includes(plugin);
}
