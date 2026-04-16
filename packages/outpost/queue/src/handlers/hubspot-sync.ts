/**
 * HUBSPOT_SYNC job handler.
 *
 * Runs daily via the scheduler (or on-demand). Pulls companies from
 * HubSpot and upserts them as Outpost accounts.
 *
 * If the payload includes a `domain`, syncs only that single account.
 * Otherwise, syncs all HubSpot companies.
 */

import { prisma } from '@copilotkit/outpost/db';
import {
    HubSpotClient,
    HubSpotSyncService,
} from '@copilotkit/outpost/shared';
import type { AccountStore } from '@copilotkit/outpost/shared';
import type { JobHandler } from '../types.js';
import { JobType } from '../types.js';

/**
 * Build an AccountStore backed by Prisma for production use.
 */
function createPrismaAccountStore(): AccountStore {
    return {
        async findByDomain(domain: string) {
            const account = await prisma.account.findFirst({
                where: { domain },
            });
            if (!account) return null;
            return {
                id: account.id,
                name: account.name,
                domain: account.domain,
                acv: account.acv,
                closeDate: account.closeDate,
                owner: account.owner,
            };
        },

        async create(data) {
            await prisma.account.create({
                data: {
                    name: data.name,
                    domain: data.domain,
                    acv: data.acv,
                    closeDate: data.closeDate,
                    owner: data.owner,
                },
            });
        },

        async update(id, data) {
            await prisma.account.update({
                where: { id },
                data: {
                    ...(data.acv !== undefined && { acv: data.acv }),
                    ...(data.closeDate !== undefined && { closeDate: data.closeDate }),
                    ...(data.owner !== undefined && { owner: data.owner }),
                },
            });
        },
    };
}

export const handleHubSpotSync: JobHandler<typeof JobType.HUBSPOT_SYNC> = async (
    payload,
    context,
) => {
    await context.reportProgress(5);

    let client: HubSpotClient;
    try {
        client = new HubSpotClient();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: `HubSpot client initialization failed: ${message}`,
        };
    }

    const store = createPrismaAccountStore();
    const syncService = new HubSpotSyncService(client, store);

    await context.reportProgress(10);

    const report = payload.domain
        ? await syncService.syncSingleAccount(payload.domain)
        : await syncService.syncAllAccounts();

    await context.reportProgress(90);

    const hasErrors = report.errors.length > 0;
    const summary = `Created: ${report.created}, Updated: ${report.updated}, Skipped: ${report.skipped}, Errors: ${report.errors.length}`;

    console.log(`[HubSpot Sync] ${summary}`);

    if (hasErrors) {
        for (const err of report.errors) {
            console.error(
                `[HubSpot Sync] Error for company ${err.companyId}: ${err.message}`,
            );
        }
    }

    await context.reportProgress(100);

    return {
        success: !hasErrors || report.created > 0 || report.updated > 0,
        data: {
            created: report.created,
            updated: report.updated,
            skipped: report.skipped,
            errorCount: report.errors.length,
            syncedAt: report.syncedAt,
        },
        ...(hasErrors && {
            error: `${report.errors.length} error(s) during sync. First: ${report.errors[0].message}`,
        }),
    };
};
