import { describe, it, expect, vi } from 'vitest';
import { loadPriorityMap } from '../priority-map.js';
import { TicketPriority } from '../../types.js';

function makeDb(row: { key: string; value: string } | null) {
    return { systemConfig: { findUnique: vi.fn().mockResolvedValue(row) } };
}

describe('loadPriorityMap', () => {
    it('falls back to the hardcoded Linear map when no config row exists', async () => {
        const db = makeDb(null);
        const map = await loadPriorityMap('linear', db);

        // Linear default: '1' (Urgent) → CRITICAL
        expect(map.toOutpost('1')).toBe(TicketPriority.CRITICAL);
    });

    it('falls back to the hardcoded GitHub map when no config row exists', async () => {
        const db = makeDb(null);
        const map = await loadPriorityMap('github', db);

        expect(map.toOutpost('high')).toBe(TicketPriority.HIGH);
    });

    it('builds from persisted config when present for the requested plugin', async () => {
        const config = {
            priorityMappings: {
                linear: [{ externalPriority: 'P1', outpostPriority: 'CRITICAL' }],
            },
        };
        const db = makeDb({ key: 'sync.mappingConfig', value: JSON.stringify(config) });

        const map = await loadPriorityMap('linear', db);

        expect(map.toOutpost('P1')).toBe(TicketPriority.CRITICAL);
        // '1' is no longer mapped since the persisted config replaced it entirely
        expect(map.toOutpost('1')).toBe(TicketPriority.MEDIUM); // PriorityMap.toOutpost default fallback
    });

    it('falls back to defaults when persisted config has no entry for this plugin', async () => {
        const config = {
            priorityMappings: { linear: [{ externalPriority: 'P1', outpostPriority: 'HIGH' }] },
        };
        const db = makeDb({ key: 'sync.mappingConfig', value: JSON.stringify(config) });

        const map = await loadPriorityMap('github', db);

        expect(map.toOutpost('high')).toBe(TicketPriority.HIGH);
    });

    it('falls back to defaults when the persisted value is malformed JSON', async () => {
        const db = makeDb({ key: 'sync.mappingConfig', value: 'not json' });

        const map = await loadPriorityMap('linear', db);

        expect(map.toOutpost('1')).toBe(TicketPriority.CRITICAL);
    });

    it('skips a persisted entry whose outpostPriority is not a valid TicketPriority enum value', async () => {
        const config = {
            priorityMappings: {
                linear: [
                    { externalPriority: 'P1', outpostPriority: 'CRITICAL' },
                    { externalPriority: 'Pbad', outpostPriority: 'NOT_A_REAL_PRIORITY' },
                ],
            },
        };
        const db = makeDb({ key: 'sync.mappingConfig', value: JSON.stringify(config) });

        const map = await loadPriorityMap('linear', db);

        expect(map.toOutpost('P1')).toBe(TicketPriority.CRITICAL);
        // The invalid entry was skipped → falls through to the default MEDIUM
        expect(map.toOutpost('Pbad')).toBe(TicketPriority.MEDIUM);
    });
});
