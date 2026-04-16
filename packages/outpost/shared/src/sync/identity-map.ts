/**
 * Identity mapping between external user IDs and Outpost TeamMembers.
 *
 * Uses the ExternalIdentity Prisma model to resolve and register
 * mappings. Prisma client is dependency-injected so this layer
 * stays testable without a real database.
 */

import type { TeamMemberRef } from './types.js';

// ─── Prisma Interface (DI) ───────────────────────────────────────────────

/** Minimal Prisma subset needed by IdentityMapper. */
export interface IdentityMapperDeps {
    externalIdentity: {
        findUnique(args: {
            where: { plugin_externalId: { plugin: string; externalId: string } };
            include: { member: boolean };
        }): Promise<IdentityWithMember | null>;

        findFirst(args: {
            where: { plugin: string; memberId: string };
        }): Promise<{ id: string; plugin: string; externalId: string; memberId: string } | null>;

        findMany(args: {
            where: { plugin: string; externalId: { in: string[] } };
            include: { member: boolean };
        }): Promise<IdentityWithMember[]>;

        create(args: {
            data: { plugin: string; externalId: string; memberId: string };
        }): Promise<{ id: string; plugin: string; externalId: string; memberId: string }>;
    };
}

/** Shape returned by Prisma when including the member relation. */
interface IdentityWithMember {
    id: string;
    plugin: string;
    externalId: string;
    memberId: string;
    member: {
        id: string;
        name: string;
        email: string;
    };
}

// ─── IdentityMapper ───────────────────────────────────────────────────────

export class IdentityMapper {
    private readonly prisma: IdentityMapperDeps;

    constructor(prisma: IdentityMapperDeps) {
        this.prisma = prisma;
    }

    /**
     * Resolve an external user ID to an Outpost TeamMember.
     * Returns null if no mapping exists.
     */
    async resolve(plugin: string, externalUserId: string): Promise<TeamMemberRef | null> {
        const identity = await this.prisma.externalIdentity.findUnique({
            where: {
                plugin_externalId: { plugin, externalId: externalUserId },
            },
            include: { member: true },
        });

        if (!identity) {
            return null;
        }

        return {
            id: identity.member.id,
            name: identity.member.name,
            email: identity.member.email,
        };
    }

    /**
     * Register a mapping between an external user and an Outpost TeamMember.
     */
    async register(plugin: string, externalUserId: string, memberId: string): Promise<void> {
        await this.prisma.externalIdentity.create({
            data: {
                plugin,
                externalId: externalUserId,
                memberId,
            },
        });
    }

    /**
     * Resolve an Outpost member ID to their external identity for a given plugin.
     * Returns the external identity (with externalId) or null if not found.
     */
    async resolveByMemberId(
        plugin: string,
        memberId: string,
    ): Promise<{ externalId: string; memberId: string } | null> {
        const identity = await this.prisma.externalIdentity.findFirst({
            where: { plugin, memberId },
        });

        if (!identity) return null;
        return { externalId: identity.externalId, memberId: identity.memberId };
    }

    /**
     * Batch-resolve multiple external user IDs.
     * Returns a map of externalUserId → TeamMemberRef (missing IDs omitted).
     */
    async bulkResolve(
        plugin: string,
        externalUserIds: string[],
    ): Promise<Map<string, TeamMemberRef>> {
        const identities = await this.prisma.externalIdentity.findMany({
            where: {
                plugin,
                externalId: { in: externalUserIds },
            },
            include: { member: true },
        });

        const result = new Map<string, TeamMemberRef>();
        for (const identity of identities) {
            result.set(identity.externalId, {
                id: identity.member.id,
                name: identity.member.name,
                email: identity.member.email,
            });
        }

        return result;
    }
}
