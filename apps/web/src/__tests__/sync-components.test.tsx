import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SyncHealthCards } from '@/components/sync/sync-health';
import { ConflictQueue } from '@/components/sync/conflict-queue';
import { MappingEditor } from '@/components/sync/mapping-editor';
import { SyncEventLog } from '@/components/sync/sync-event-log';
import {
    MOCK_SYSTEM_STATUS,
    MOCK_MAPPING_CONFIG,
    MOCK_SYNC_EVENTS,
    getUnresolvedConflicts,
} from '@/lib/mock-sync';
import type { SyncEvent } from '@/lib/mock-sync';

// ─── SyncHealthCards ──────────────────────────────────────────────────────

describe('SyncHealthCards', () => {
    it('renders a card for each system', () => {
        render(<SyncHealthCards systems={MOCK_SYSTEM_STATUS} />);
        expect(screen.getByTestId('sync-health-cards')).toBeDefined();
        for (const sys of MOCK_SYSTEM_STATUS) {
            expect(screen.getByTestId(`sync-health-${sys.plugin}`)).toBeDefined();
        }
    });

    it('displays the health indicator dot', () => {
        render(<SyncHealthCards systems={MOCK_SYSTEM_STATUS} />);
        for (const sys of MOCK_SYSTEM_STATUS) {
            expect(screen.getByTestId(`health-dot-${sys.plugin}`)).toBeDefined();
        }
    });

    it('displays latency metrics', () => {
        render(<SyncHealthCards systems={MOCK_SYSTEM_STATUS} />);
        for (const sys of MOCK_SYSTEM_STATUS) {
            const card = screen.getByTestId(`sync-health-${sys.plugin}`);
            expect(card.textContent).toContain(`p50: ${sys.p50LatencyMs}ms`);
            expect(card.textContent).toContain(`p95: ${sys.p95LatencyMs}ms`);
        }
    });

    it('assigns a data-health attribute based on health color', () => {
        render(<SyncHealthCards systems={MOCK_SYSTEM_STATUS} />);
        for (const sys of MOCK_SYSTEM_STATUS) {
            const card = screen.getByTestId(`sync-health-${sys.plugin}`);
            const health = card.getAttribute('data-health');
            expect(['green', 'yellow', 'red']).toContain(health);
        }
    });

    it('renders empty when no systems', () => {
        render(<SyncHealthCards systems={[]} />);
        const container = screen.getByTestId('sync-health-cards');
        expect(container.children).toHaveLength(0);
    });
});

// ─── ConflictQueue ────────────────────────────────────────────────────────

describe('ConflictQueue', () => {
    const conflicts = getUnresolvedConflicts();

    it('renders conflict rows', () => {
        render(<ConflictQueue conflicts={conflicts} onResolve={vi.fn()} />);
        expect(screen.getByTestId('conflict-queue')).toBeDefined();
        for (const c of conflicts) {
            expect(screen.getByTestId(`conflict-row-${c.id}`)).toBeDefined();
        }
    });

    it('shows empty state when no conflicts', () => {
        render(<ConflictQueue conflicts={[]} onResolve={vi.fn()} />);
        expect(screen.getByTestId('conflict-queue-empty')).toBeDefined();
    });

    it('displays ticket ID and conflict field for each row', () => {
        render(<ConflictQueue conflicts={conflicts} onResolve={vi.fn()} />);
        for (const c of conflicts) {
            const row = screen.getByTestId(`conflict-row-${c.id}`);
            expect(row.textContent).toContain(c.ticketId);
            expect(row.textContent).toContain(c.conflictField!);
        }
    });

    it('renders resolve buttons for each conflict', () => {
        render(<ConflictQueue conflicts={conflicts} onResolve={vi.fn()} />);
        for (const c of conflicts) {
            expect(screen.getByTestId(`resolve-outpost-${c.id}`)).toBeDefined();
            expect(screen.getByTestId(`resolve-external-${c.id}`)).toBeDefined();
        }
    });

    it('calls onResolve with outpost when Accept Outpost is clicked', () => {
        const onResolve = vi.fn();
        render(<ConflictQueue conflicts={conflicts} onResolve={onResolve} />);
        const first = conflicts[0];
        fireEvent.click(screen.getByTestId(`resolve-outpost-${first.id}`));
        expect(onResolve).toHaveBeenCalledWith(first.id, 'outpost');
    });

    it('calls onResolve with external when Accept External is clicked', () => {
        const onResolve = vi.fn();
        render(<ConflictQueue conflicts={conflicts} onResolve={onResolve} />);
        const first = conflicts[0];
        fireEvent.click(screen.getByTestId(`resolve-external-${first.id}`));
        expect(onResolve).toHaveBeenCalledWith(first.id, 'external');
    });
});

// ─── MappingEditor ────────────────────────────────────────────────────────

describe('MappingEditor', () => {
    it('renders the mapping editor with tabs', () => {
        render(<MappingEditor config={MOCK_MAPPING_CONFIG} onSave={vi.fn()} />);
        expect(screen.getByTestId('mapping-editor')).toBeDefined();
        expect(screen.getByTestId('mapping-tab-status')).toBeDefined();
        expect(screen.getByTestId('mapping-tab-priority')).toBeDefined();
        expect(screen.getByTestId('mapping-tab-identity')).toBeDefined();
        expect(screen.getByTestId('mapping-tab-labels')).toBeDefined();
    });

    it('shows status mapping panel by default', () => {
        render(<MappingEditor config={MOCK_MAPPING_CONFIG} onSave={vi.fn()} />);
        expect(screen.getByTestId('status-mapping-panel')).toBeDefined();
    });

    it('switches to priority tab when clicked', () => {
        render(<MappingEditor config={MOCK_MAPPING_CONFIG} onSave={vi.fn()} />);
        fireEvent.click(screen.getByTestId('mapping-tab-priority'));
        expect(screen.getByTestId('priority-mapping-panel')).toBeDefined();
    });

    it('switches to identity tab when clicked', () => {
        render(<MappingEditor config={MOCK_MAPPING_CONFIG} onSave={vi.fn()} />);
        fireEvent.click(screen.getByTestId('mapping-tab-identity'));
        expect(screen.getByTestId('identity-mapping-panel')).toBeDefined();
    });

    it('switches to labels tab when clicked', () => {
        render(<MappingEditor config={MOCK_MAPPING_CONFIG} onSave={vi.fn()} />);
        fireEvent.click(screen.getByTestId('mapping-tab-labels'));
        expect(screen.getByTestId('label-rules-panel')).toBeDefined();
    });

    it('shows save button after a mapping change', () => {
        render(<MappingEditor config={MOCK_MAPPING_CONFIG} onSave={vi.fn()} />);
        // Initially no save button
        expect(screen.queryByTestId('mapping-save')).toBeNull();

        // Change a status mapping
        const select = screen.getByTestId('status-select-linear-0');
        fireEvent.change(select, { target: { value: 'CLOSED' } });

        expect(screen.getByTestId('mapping-save')).toBeDefined();
    });

    it('calls onSave when save button clicked', () => {
        const onSave = vi.fn();
        render(<MappingEditor config={MOCK_MAPPING_CONFIG} onSave={onSave} />);

        const select = screen.getByTestId('status-select-linear-0');
        fireEvent.change(select, { target: { value: 'CLOSED' } });
        fireEvent.click(screen.getByTestId('mapping-save'));

        expect(onSave).toHaveBeenCalledOnce();
        const savedConfig = onSave.mock.calls[0][0];
        expect(savedConfig.statusMappings.linear[0].outpostStatus).toBe('CLOSED');
    });

    it('shows link buttons for unlinked identity mappings', () => {
        render(<MappingEditor config={MOCK_MAPPING_CONFIG} onSave={vi.fn()} />);
        fireEvent.click(screen.getByTestId('mapping-tab-identity'));

        const unlinked = MOCK_MAPPING_CONFIG.identityMappings.filter((m) => !m.memberId);
        for (const m of unlinked) {
            expect(screen.getByTestId(`link-identity-${m.id}`)).toBeDefined();
        }
    });
});

// ─── SyncEventLog ─────────────────────────────────────────────────────────

describe('SyncEventLog', () => {
    it('renders the event log table', () => {
        render(<SyncEventLog events={MOCK_SYNC_EVENTS} onFilterChange={vi.fn()} />);
        expect(screen.getByTestId('sync-event-log')).toBeDefined();
    });

    it('renders rows for each event', () => {
        render(<SyncEventLog events={MOCK_SYNC_EVENTS} onFilterChange={vi.fn()} />);
        for (const event of MOCK_SYNC_EVENTS) {
            expect(screen.getByTestId(`event-row-${event.id}`)).toBeDefined();
        }
    });

    it('renders filter dropdowns', () => {
        render(<SyncEventLog events={MOCK_SYNC_EVENTS} onFilterChange={vi.fn()} />);
        expect(screen.getByTestId('filter-source')).toBeDefined();
        expect(screen.getByTestId('filter-status')).toBeDefined();
    });

    it('calls onFilterChange when source filter changes', () => {
        const onFilterChange = vi.fn();
        render(<SyncEventLog events={MOCK_SYNC_EVENTS} onFilterChange={onFilterChange} />);
        fireEvent.change(screen.getByTestId('filter-source'), { target: { value: 'github' } });
        expect(onFilterChange).toHaveBeenCalledWith(
            expect.objectContaining({ sourcePlugin: 'github' }),
        );
    });

    it('calls onFilterChange when status filter changes', () => {
        const onFilterChange = vi.fn();
        render(<SyncEventLog events={MOCK_SYNC_EVENTS} onFilterChange={onFilterChange} />);
        fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'failed' } });
        expect(onFilterChange).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'failed' }),
        );
    });

    it('shows empty state when no events', () => {
        render(<SyncEventLog events={[]} onFilterChange={vi.fn()} />);
        expect(screen.getByText('No sync events found.')).toBeDefined();
    });
});
