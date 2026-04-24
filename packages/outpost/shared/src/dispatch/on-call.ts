/**
 * On-call rotation for the dispatch engine.
 *
 * Simple round-robin rotation through a list of team member IDs.
 * The list is configured via the ON_CALL_MEMBERS environment variable
 * (comma-separated team member IDs).
 *
 * The rotation index is persisted via a PrismaLike interface
 * (SystemConfig table) so it survives process restarts.
 * Callers must inject a database instance.
 */

const ROTATION_KEY = 'oncall_rotation_index';

/**
 * Minimal Prisma-like interface for the SystemConfig table,
 * allowing callers to inject the real prisma client or a test double.
 */
export interface PrismaLike {
    systemConfig: {
        findUnique(args: { where: { key: string } }): Promise<{ key: string; value: string } | null>;
        upsert(args: {
            where: { key: string };
            update: { value: string };
            create: { key: string; value: string };
        }): Promise<{ key: string; value: string }>;
    };
}

/**
 * Parse the on-call member list from an environment variable or explicit list.
 */
export function getOnCallMembers(envValue?: string): string[] {
    const raw = envValue ?? process.env.ON_CALL_MEMBERS ?? '';
    return raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
}

/**
 * Read the current rotation index from the database.
 * Returns 0 if no record exists yet.
 */
async function readIndex(db: PrismaLike): Promise<number> {
    const row = await db.systemConfig.findUnique({ where: { key: ROTATION_KEY } });
    if (!row) return 0;
    const parsed = parseInt(row.value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Write the rotation index to the database.
 */
async function writeIndex(index: number, db: PrismaLike): Promise<void> {
    await db.systemConfig.upsert({
        where: { key: ROTATION_KEY },
        update: { value: String(index) },
        create: { key: ROTATION_KEY, value: String(index) },
    });
}

/**
 * Get the current on-call team member ID using round-robin rotation.
 *
 * Returns null if no on-call members are configured.
 * Each call advances the rotation to the next member and persists
 * the new index in the database.
 *
 * @param members - Override on-call member list (defaults to ON_CALL_MEMBERS env var)
 * @param db - Database instance implementing PrismaLike (required for persistence)
 */
export async function getCurrentOnCall(
    members?: string[],
    db?: PrismaLike,
): Promise<string | null> {
    const onCallMembers = members ?? getOnCallMembers();

    if (onCallMembers.length === 0) {
        return null;
    }

    if (!db) {
        // No database provided — return first member without persistence.
        // This should only happen in development or misconfigured environments.
        return onCallMembers[0];
    }

    const currentIndex = (await readIndex(db)) % onCallMembers.length;
    const nextIndex = (currentIndex + 1) % onCallMembers.length;
    await writeIndex(nextIndex, db);

    return onCallMembers[currentIndex];
}

/**
 * Peek at the current on-call member without advancing the rotation.
 */
export async function peekOnCall(
    members?: string[],
    db?: PrismaLike,
): Promise<string | null> {
    const onCallMembers = members ?? getOnCallMembers();

    if (onCallMembers.length === 0) {
        return null;
    }

    if (!db) {
        return onCallMembers[0];
    }

    const currentIndex = (await readIndex(db)) % onCallMembers.length;
    return onCallMembers[currentIndex];
}

/**
 * Reset the rotation index to zero.
 */
export async function resetRotation(db?: PrismaLike): Promise<void> {
    if (!db) return;
    await writeIndex(0, db);
}
