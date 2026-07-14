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
import { createLinearPriorityMap } from './priority-map.js';
import { createLinearLabelMapper } from './label-map.js';
import { IdentityMapper } from './identity-map.js';
import type { IdentityMapperDeps } from './identity-map.js';

// ─── Configuration ──────────────────────────────────────────────────────

interface InitOptions {
    /** Override for dependency injection (testing). */
    deps: SyncEngineDeps;
    /** Override for identity mapper deps (testing). */
    identityDeps?: IdentityMapperDeps;
    /** Override for environment variables (testing). */
    env?: Record<string, string | undefined>;
    /** Pre-built StatusMap to use instead of createLinearStatusMap(). */
    statusMapOverride?: StatusMap;
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

        if (identityMapper) {
            const adapter = new LinearAdapter({
                apiKey: linearApiKey,
                teamId: linearTeamId,
                statusMap: options.statusMapOverride ?? createLinearStatusMap(),
                priorityMap: createLinearPriorityMap(),
                labelMapper: createLinearLabelMapper(),
                identityMapper,
            });
            engine.registerInternalTracker(adapter);
        }
    }

    return engine;
}
