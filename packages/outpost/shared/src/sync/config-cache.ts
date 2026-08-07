import type { StatusMapDb } from './status-map.js';

/**
 * Wraps a db so repeated `systemConfig.findUnique` calls for the same key share
 * one round-trip.
 *
 * Each mapping loader (loadStatusMap / loadPriorityMap / loadLabelMapper) takes a
 * db and does its own lookup, so calling several of them re-fetches the SAME
 * SystemConfig row once per loader. This collapses that to a single query while
 * leaving the loaders' signatures — and their independent fallbacks — untouched.
 *
 * Scope one of these to a single request or a single boot and let it go out of
 * scope afterwards. The cache dies with the object, so there is no staleness
 * window; it is deliberately NOT a process-wide cache.
 */
export function singleReadConfigDb(db: StatusMapDb): StatusMapDb {
    const inFlight = new Map<string, Promise<{ key: string; value: string } | null>>();

    return {
        systemConfig: {
            findUnique: (args: { where: { key: string } }) => {
                const key = args.where.key;
                let promise = inFlight.get(key);
                if (!promise) {
                    promise = db.systemConfig.findUnique(args);
                    inFlight.set(key, promise);
                }
                return promise;
            },
        },
    } as unknown as StatusMapDb;
}
