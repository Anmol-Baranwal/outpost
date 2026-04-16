/**
 * HubSpot sync service for upserting HubSpot companies into Outpost accounts.
 *
 * Handles both full syncs (all companies) and single-account syncs by domain.
 * Returns a sync report with counts of created, updated, skipped, and errored records.
 */
import type { OutpostAccountData } from './hubspot.js';
import { HubSpotClient } from './hubspot.js';
export interface SyncReport {
    created: number;
    updated: number;
    skipped: number;
    errors: SyncError[];
    syncedAt: string;
}
export interface SyncError {
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
export declare class HubSpotSyncService {
    private client;
    private store;
    constructor(client: HubSpotClient, store: AccountStore);
    /**
     * Sync all HubSpot companies into Outpost accounts.
     * For each company:
     *   - If it has no domain, skip it (we can't match without a domain)
     *   - If no matching account exists, create one
     *   - If a matching account exists, update ACV, closeDate, and owner
     */
    syncAllAccounts(): Promise<SyncReport>;
    /**
     * Sync a single account by domain lookup in HubSpot.
     */
    syncSingleAccount(domain: string): Promise<SyncReport>;
    /**
     * Process a single HubSpot company: map to account data, then create or update.
     */
    private syncOneCompany;
}
//# sourceMappingURL=hubspot-sync.d.ts.map