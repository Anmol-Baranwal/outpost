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
 *
 * KNOWN LIMITATION: this is a static list, while registration is additionally
 * conditional on env — initializeSyncEngine() only registers Linear when both
 * LINEAR_API_KEY and LINEAR_TEAM_ID are set. A deployment missing those has no
 * Linear adapter even though `supportsOutboundSync('linear')` returns true, so
 * the DLQ flood this list exists to prevent is still reachable by
 * misconfiguration rather than by design. Closing that properly means the
 * worker publishing what it actually registered (a job the /health work in #138
 * is better placed to do) rather than the web app guessing at the worker's env,
 * since the two are separate deployments and their env can differ.
 */
export const OUTBOUND_SYNC_PLUGINS = ['linear'] as const;

export type OutboundSyncPlugin = (typeof OUTBOUND_SYNC_PLUGINS)[number];

/** True when `plugin` has a registered outbound adapter. */
export function supportsOutboundSync(plugin: string): plugin is OutboundSyncPlugin {
    return (OUTBOUND_SYNC_PLUGINS as readonly string[]).includes(plugin);
}
