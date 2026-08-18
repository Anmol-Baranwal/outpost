import { describe, it, expect, vi } from 'vitest';
import { loadStatusMap } from '../status-map.js';
import { TicketStatus } from '../../types.js';

function makeDb(row: { key: string; value: string } | null) {
    return { systemConfig: { findUnique: vi.fn().mockResolvedValue(row) } };
}

describe('loadStatusMap', () => {
    it('falls back to the hardcoded Linear map when no config row exists', async () => {
        const db = makeDb(null);
        const map = await loadStatusMap('linear', db);

        expect(map.toOutpost('Done')).toBe(TicketStatus.RESOLVED);
    });

    it('falls back to the hardcoded GitHub map when no config row exists', async () => {
        const db = makeDb(null);
        const map = await loadStatusMap('github', db);

        expect(map.toOutpost('closed')).toBe(TicketStatus.CLOSED);
    });

    it('builds from persisted config when present for the requested plugin', async () => {
        const config = {
            statusMappings: {
                linear: [{ externalStatus: 'Shipped', outpostStatus: 'RESOLVED' }],
            },
        };
        const db = makeDb({ key: 'sync.mappingConfig', value: JSON.stringify(config) });

        const map = await loadStatusMap('linear', db);

        expect(map.toOutpost('Shipped')).toBe(TicketStatus.RESOLVED);
        // 'Done' is no longer in the map since the persisted config replaced it entirely
        expect(map.toOutpost('Done')).toBe(TicketStatus.OPEN); // StatusMap.toOutpost default fallback
    });

    it('falls back to defaults when persisted config has no entry for this plugin', async () => {
        const config = {
            statusMappings: { linear: [{ externalStatus: 'X', outpostStatus: 'OPEN' }] },
        };
        const db = makeDb({ key: 'sync.mappingConfig', value: JSON.stringify(config) });

        const map = await loadStatusMap('github', db);

        expect(map.toOutpost('closed')).toBe(TicketStatus.CLOSED);
    });

    it('falls back to defaults when the persisted value is malformed JSON', async () => {
        const db = makeDb({ key: 'sync.mappingConfig', value: 'not json' });

        const map = await loadStatusMap('linear', db);

        expect(map.toOutpost('Done')).toBe(TicketStatus.RESOLVED);
    });

    it('skips a persisted entry whose outpostStatus is not a valid TicketStatus enum value', async () => {
        const config = {
            statusMappings: {
                linear: [
                    { externalStatus: 'Shipped', outpostStatus: 'RESOLVED' },
                    { externalStatus: 'Custom', outpostStatus: 'NOT_A_REAL_STATUS' },
                ],
            },
        };
        const db = makeDb({ key: 'sync.mappingConfig', value: JSON.stringify(config) });

        const map = await loadStatusMap('linear', db);

        expect(map.toOutpost('Shipped')).toBe(TicketStatus.RESOLVED);
        // Invalid entry must not pass through as a literal garbage string.
        expect(map.toOutpost('Custom')).toBe(TicketStatus.OPEN);
    });

    it('falls back to the hardcoded default map when every persisted entry for a plugin is invalid', async () => {
        const config = {
            statusMappings: {
                linear: [{ externalStatus: 'Custom', outpostStatus: 'NOT_A_REAL_STATUS' }],
            },
        };
        const db = makeDb({ key: 'sync.mappingConfig', value: JSON.stringify(config) });

        const map = await loadStatusMap('linear', db);

        // All entries filtered out -> falls back to createLinearStatusMap() defaults.
        expect(map.toOutpost('Done')).toBe(TicketStatus.RESOLVED);
        expect(map.toOutpost('Custom')).toBe(TicketStatus.OPEN);
    });
});
