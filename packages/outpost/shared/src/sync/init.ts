/**
 * SyncEngine initialization.
 *
 * Creates a configured SyncEngine instance with all available adapters
 * registered. Adapters are only registered when their required env vars
 * are present — gracefully degrades when not configured.
 */

import { SyncEngine } from './engine.js';
import type { SyncEngineDeps } from './engine.js';
import { LinearAdapter } from './adapters/linear.js';
import { createLinearStatusMap, StatusMap } from './status-map.js';
import { createLinearPriorityMap, PriorityMap } from './priority-map.js';
import { createLinearLabelMapper, LabelMapper } from './label-map.js';
import { IdentityMapper } from './identity-map.js';
import type { IdentityMapperDeps } from './identity-map.js';

// ─── Configuration ──────────────────────────────────────────────────────

interface InitOptions {
    /**
     * Prisma + createJob the engine runs against. REQUIRED — despite the wording
     * this replaces, it is not a testing-only override; production passes it too.
     */
    deps: SyncEngineDeps;
    /** Override for identity mapper deps (testing). */
    identityDeps?: IdentityMapperDeps;
    /** Override for environment variables (testing). */
    env?: Record<string, string | undefined>;
    /** Pre-built StatusMap to use instead of createLinearStatusMap(). */
    statusMapOverride?: StatusMap;
    /** Pre-built PriorityMap to use instead of createLinearPriorityMap(). */
    priorityMapOverride?: PriorityMap;
    /** Pre-built LabelMapper to use instead of createLinearLabelMapper(). */
    labelMapperOverride?: LabelMapper;
}

// ─── Initialization ─────────────────────────────────────────────────────

/**
 * Create and configure a SyncEngine with all available adapters.
 *
 * Reads adapter configs from environment variables (or the provided env
 * override). Only registers adapters whose required env vars are all present.
 *
 * Required env vars per adapter:
 * - Linear: LINEAR_API_KEY, LINEAR_TEAM_ID
 */
export function initializeSyncEngine(options: InitOptions): SyncEngine {
    const env = options.env ?? process.env;
    const engine = new SyncEngine(options.deps);

    // ─── Linear Adapter ─────────────────────────────────────────────
    const linearApiKey = env.LINEAR_API_KEY;
    const linearTeamId = env.LINEAR_TEAM_ID;

    if (linearApiKey && linearTeamId) {
        const identityMapper = options.identityDeps
            ? new IdentityMapper(options.identityDeps)
            : null;

        if (!identityMapper) {
            // Both env vars are set, so the operator intended Linear sync — but
            // without identityDeps no adapter is registered and TRACKER_SYNC jobs
            // fail with "Plugin is not registered". Silence here reproduces the
            // exact invisible non-registration this function was extracted to fix,
            // so it is loud instead.
            console.error(
                '[SyncEngine] LINEAR_API_KEY and LINEAR_TEAM_ID are set but identityDeps was not ' +
                    'provided — the Linear adapter is NOT registered and outbound Linear sync will ' +
                    'fail. Pass identityDeps to initializeSyncEngine().',
            );
        }

        if (identityMapper) {
            const adapter = new LinearAdapter({
                apiKey: linearApiKey,
                teamId: linearTeamId,
                statusMap: options.statusMapOverride ?? createLinearStatusMap(),
                priorityMap: options.priorityMapOverride ?? createLinearPriorityMap(),
                labelMapper: options.labelMapperOverride ?? createLinearLabelMapper(),
                identityMapper,
            });
            engine.registerInternalTracker(adapter);
        }
    }

    return engine;
}
