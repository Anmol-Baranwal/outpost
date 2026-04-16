/**
 * HubSpot sync service for upserting HubSpot companies into Outpost accounts.
 *
 * Handles both full syncs (all companies) and single-account syncs by domain.
 * Returns a sync report with counts of created, updated, skipped, and errored records.
 */

import type { OutpostAccountData, HubSpotCompany } from './hubspot.js';
import { HubSpotClient } from './hubspot.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SyncReport {
    created: number;
    updated: number;
    skipped: number;
    errors: HubSpotSyncError[];
    syncedAt: string;
}

export interface HubSpotSyncError {
    companyId: string;
    companyName: string | undefined;
    message: string;
}

/**
 * Minimal account store interface for decoupling from Prisma in tests.
 * In production, pass an object backed by prisma.account.
 */
export interface AccountStore {
    findByDomain(domain: string): Promise<ExistingAccount | null>;
    create(data: OutpostAccountData): Promise<void>;
    update(id: string, data: Partial<OutpostAccountData>): Promise<void>;
}

export interface ExistingAccount {
    id: string;
    name: string;
    domain: string | null;
    acv: number | null;
    closeDate: Date | null;
    owner: string | null;
}

// ─── Sync Service ──────────────────────────────────────────────────────────

export class HubSpotSyncService {
    private client: HubSpotClient;
    private store: AccountStore;

    constructor(client: HubSpotClient, store: AccountStore) {
        this.client = client;
        this.store = store;
    }

    /**
     * Sync all HubSpot companies into Outpost accounts.
     * For each company:
     *   - If it has no domain, skip it (we can't match without a domain)
     *   - If no matching account exists, create one
     *   - If a matching account exists, update ACV, closeDate, and owner
     */
    async syncAllAccounts(): Promise<SyncReport> {
        const report: SyncReport = {
            created: 0,
            updated: 0,
            skipped: 0,
            errors: [],
            syncedAt: new Date().toISOString(),
        };

        let companies: HubSpotCompany[];
        try {
            companies = await this.client.getCompanies();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            report.errors.push({
                companyId: 'N/A',
                companyName: undefined,
                message: `Failed to fetch companies from HubSpot: ${message}`,
            });
            return report;
        }

        for (const company of companies) {
            await this.syncOneCompany(company, report);
        }

        return report;
    }

    /**
     * Sync a single account by domain lookup in HubSpot.
     */
    async syncSingleAccount(domain: string): Promise<SyncReport> {
        const report: SyncReport = {
            created: 0,
            updated: 0,
            skipped: 0,
            errors: [],
            syncedAt: new Date().toISOString(),
        };

        let company: HubSpotCompany | null;
        try {
            company = await this.client.getCompanyByDomain(domain);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            report.errors.push({
                companyId: 'N/A',
                companyName: undefined,
                message: `Failed to search HubSpot for domain ${domain}: ${message}`,
            });
            return report;
        }

        if (!company) {
            report.skipped++;
            return report;
        }

        await this.syncOneCompany(company, report);
        return report;
    }

    /**
     * Process a single HubSpot company: map to account data, then create or update.
     */
    private async syncOneCompany(
        company: HubSpotCompany,
        report: SyncReport,
    ): Promise<void> {
        try {
            const accountData = await this.client.syncCompanyToAccount(company);

            // Skip companies without a domain — we can't match them to accounts
            if (!accountData.domain) {
                report.skipped++;
                return;
            }

            const existing = await this.store.findByDomain(accountData.domain);

            if (existing) {
                // Update mutable fields only: ACV, closeDate, owner
                await this.store.update(existing.id, {
                    acv: accountData.acv,
                    closeDate: accountData.closeDate,
                    owner: accountData.owner,
                });
                report.updated++;
            } else {
                await this.store.create(accountData);
                report.created++;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            report.errors.push({
                companyId: company.id,
                companyName: company.properties.name,
                message,
            });
        }
    }
}
