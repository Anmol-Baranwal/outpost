/**
 * HubSpot CRM client for syncing company data into Outpost accounts.
 *
 * Authenticates via HUBSPOT_API_KEY env var and provides methods to
 * fetch companies and map them to the Outpost Account model.
 */
import { Client } from '@hubspot/api-client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/companies/models/Filter';
// ─── Client ────────────────────────────────────────────────────────────────
export class HubSpotClient {
    client;
    ownerCache = new Map();
    constructor(apiKey) {
        const accessToken = apiKey ?? process.env.HUBSPOT_API_KEY;
        if (!accessToken) {
            throw new Error('HubSpot API key is required. Set HUBSPOT_API_KEY env var or pass it to the constructor.');
        }
        this.client = new Client({ accessToken });
    }
    /**
     * Fetch all companies from HubSpot, paginating through the full list.
     * Returns raw HubSpot company objects.
     */
    async getCompanies() {
        const companies = [];
        let after;
        const properties = [
            'name',
            'domain',
            'amount',
            'closedate',
            'hubspot_owner_id',
        ];
        do {
            const response = await this.client.crm.companies.basicApi.getPage(100, // limit
            after, properties);
            for (const result of response.results) {
                companies.push({
                    id: result.id,
                    properties: result.properties,
                });
            }
            after = response.paging?.next?.after;
        } while (after);
        return companies;
    }
    /**
     * Search for a HubSpot company by domain.
     * Returns the first matching company or null.
     */
    async getCompanyByDomain(domain) {
        const response = await this.client.crm.companies.searchApi.doSearch({
            filterGroups: [
                {
                    filters: [
                        {
                            propertyName: 'domain',
                            operator: FilterOperatorEnum.Eq,
                            value: domain,
                        },
                    ],
                },
            ],
            properties: [
                'name',
                'domain',
                'amount',
                'closedate',
                'hubspot_owner_id',
            ],
            limit: 1,
            after: '0',
            sorts: [],
        });
        if (response.results.length === 0) {
            return null;
        }
        const result = response.results[0];
        return {
            id: result.id,
            properties: result.properties,
        };
    }
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
    async syncCompanyToAccount(company) {
        const props = company.properties;
        let ownerName = null;
        if (props.hubspot_owner_id) {
            ownerName = await this.resolveOwnerName(props.hubspot_owner_id);
        }
        let closeDate = null;
        if (props.closedate) {
            const parsed = new Date(props.closedate);
            if (!isNaN(parsed.getTime())) {
                closeDate = parsed;
            }
        }
        let acv = null;
        if (props.amount) {
            const parsed = parseFloat(props.amount);
            if (!isNaN(parsed)) {
                acv = parsed;
            }
        }
        return {
            name: props.name ?? `HubSpot Company ${company.id}`,
            domain: props.domain ?? null,
            acv,
            closeDate,
            owner: ownerName,
        };
    }
    /**
     * Resolve a HubSpot owner ID to a display name.
     * Results are cached for the lifetime of this client instance.
     */
    async resolveOwnerName(ownerId) {
        const cached = this.ownerCache.get(ownerId);
        if (cached !== undefined) {
            return cached;
        }
        try {
            const owner = await this.client.crm.owners.ownersApi.getById(parseInt(ownerId, 10));
            const name = [owner.firstName, owner.lastName]
                .filter(Boolean)
                .join(' ') || owner.email || null;
            if (name) {
                this.ownerCache.set(ownerId, name);
            }
            return name;
        }
        catch {
            console.warn(`[HubSpot] Failed to resolve owner ${ownerId}`);
            return null;
        }
    }
}
