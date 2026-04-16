/**
 * HubSpot CRM client for syncing company data into Outpost accounts.
 *
 * Authenticates via HUBSPOT_API_KEY env var and provides methods to
 * fetch companies and map them to the Outpost Account model.
 */
export interface HubSpotCompany {
    id: string;
    properties: {
        name?: string;
        domain?: string;
        amount?: string;
        closedate?: string;
        hubspot_owner_id?: string;
        hs_all_owner_ids?: string;
        [key: string]: string | undefined;
    };
}
export interface OutpostAccountData {
    name: string;
    domain: string | null;
    acv: number | null;
    closeDate: Date | null;
    owner: string | null;
}
export interface HubSpotOwner {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
}
export declare class HubSpotClient {
    private client;
    private ownerCache;
    constructor(apiKey?: string);
    /**
     * Fetch all companies from HubSpot, paginating through the full list.
     * Returns raw HubSpot company objects.
     */
    getCompanies(): Promise<HubSpotCompany[]>;
    /**
     * Search for a HubSpot company by domain.
     * Returns the first matching company or null.
     */
    getCompanyByDomain(domain: string): Promise<HubSpotCompany | null>;
    /**
     * Map a HubSpot company to the Outpost Account data model.
     *
     * Field mapping:
     *   - name: HubSpot company name
     *   - domain: HubSpot company domain
     *   - acv: HubSpot deal amount (parsed as float)
     *   - closeDate: HubSpot close date
     *   - owner: resolved from HubSpot owner ID to display name
     */
    syncCompanyToAccount(company: HubSpotCompany): Promise<OutpostAccountData>;
    /**
     * Resolve a HubSpot owner ID to a display name.
     * Results are cached for the lifetime of this client instance.
     */
    private resolveOwnerName;
}
//# sourceMappingURL=hubspot.d.ts.map