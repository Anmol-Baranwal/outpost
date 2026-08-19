/**
 * Mock data for sync dashboard pages.
 *
 * Provides realistic sync events, conflict records, and mapping
 * configuration used by the UI and API routes before a real DB
 * is wired up.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export type SyncEventStatus = 'success' | 'failed' | 'conflict' | 'pending';

export interface SyncEvent {
    id: string;
    sourcePlugin: string;
    targetPlugin: string;
    ticketId: string;
    action: string;
    status: SyncEventStatus;
    errorMessage?: string;
    /** Field in conflict, when status = 'conflict' */
    conflictField?: string;
    /** Value from source system */
    sourceValue?: string;
    /** Value from target system */
    targetValue?: string;
    createdAt: string;
    resolvedAt?: string;
}

export interface SystemSyncStatus {
    plugin: string;
    lastSuccessfulSync: string;
    pendingCount: number;
    failedCount: number;
    /**
     * Whether the worker has a registered outbound adapter for this plugin.
     * Served by /api/sync/status; gates the force-sync control. Optional so the
     * mock fixtures below stay valid — treat a missing value as "not syncable".
     */
    canForceSync?: boolean;
    /** Average round-trip latency in milliseconds */
    p50LatencyMs: number;
    p95LatencyMs: number;
}

export interface StatusMappingEntry {
    externalStatus: string;
    outpostStatus: string;
}

export interface PriorityMappingEntry {
    externalPriority: string;
    outpostPriority: string;
    /**
     * Display-only human text for `externalPriority`. #95 split the display text out
     * of the persisted key, so the key is now the raw adapter value ('0'–'4') and this
     * carries what an operator recognises ('Urgent', 'High', …). Not persisted-critical
     * and not editable — the editor renders it beside the key so the priority tab does
     * not show bare numbers.
     */
    label?: string;
}

export interface IdentityMappingEntry {
    id: string;
    externalPlugin: string;
    externalUserId: string;
    externalDisplayName: string;
    memberId: string | null;
    memberName: string | null;
}

export interface LabelMappingRule {
    externalPrefix: string;
    outpostPrefix: string;
}

export interface MappingConfig {
    statusMappings: Record<string, StatusMappingEntry[]>;
    priorityMappings: Record<string, PriorityMappingEntry[]>;
    identityMappings: IdentityMappingEntry[];
    labelRules: Record<string, LabelMappingRule[]>;
}

// ─── Mock Data ────────────────────────────────────────────────────────────

const now = new Date();
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

export const MOCK_SYNC_EVENTS: SyncEvent[] = [
    {
        id: 'se-1',
        sourcePlugin: 'linear',
        targetPlugin: 'outpost',
        ticketId: 'TK-101',
        action: 'status_change',
        status: 'success',
        createdAt: ago(2),
    },
    {
        id: 'se-2',
        sourcePlugin: 'github',
        targetPlugin: 'outpost',
        ticketId: 'TK-102',
        action: 'comment',
        status: 'success',
        createdAt: ago(5),
    },
    {
        id: 'se-3',
        sourcePlugin: 'outpost',
        targetPlugin: 'linear',
        ticketId: 'TK-103',
        action: 'status_change',
        status: 'failed',
        errorMessage: 'Linear API rate limit exceeded',
        createdAt: ago(8),
    },
    {
        id: 'se-4',
        sourcePlugin: 'linear',
        targetPlugin: 'outpost',
        ticketId: 'TK-104',
        action: 'priority_change',
        status: 'conflict',
        conflictField: 'priority',
        sourceValue: 'Urgent',
        targetValue: 'HIGH',
        createdAt: ago(12),
    },
    {
        id: 'se-5',
        sourcePlugin: 'github',
        targetPlugin: 'outpost',
        ticketId: 'TK-105',
        action: 'label_change',
        status: 'success',
        createdAt: ago(15),
    },
    {
        id: 'se-6',
        sourcePlugin: 'outpost',
        targetPlugin: 'github',
        ticketId: 'TK-106',
        action: 'comment',
        status: 'failed',
        errorMessage: 'GitHub token expired',
        createdAt: ago(20),
    },
    {
        id: 'se-7',
        sourcePlugin: 'linear',
        targetPlugin: 'outpost',
        ticketId: 'TK-107',
        action: 'assignee_change',
        status: 'conflict',
        conflictField: 'assignee',
        sourceValue: 'alice@linear',
        targetValue: 'bob@outpost',
        createdAt: ago(25),
    },
    {
        id: 'se-8',
        sourcePlugin: 'github',
        targetPlugin: 'outpost',
        ticketId: 'TK-108',
        action: 'new_issue',
        status: 'success',
        createdAt: ago(30),
    },
    {
        id: 'se-9',
        sourcePlugin: 'outpost',
        targetPlugin: 'linear',
        ticketId: 'TK-109',
        action: 'status_change',
        status: 'pending',
        createdAt: ago(1),
    },
    {
        id: 'se-10',
        sourcePlugin: 'linear',
        targetPlugin: 'outpost',
        ticketId: 'TK-110',
        action: 'status_change',
        status: 'conflict',
        conflictField: 'status',
        sourceValue: 'In Progress',
        targetValue: 'OPEN',
        createdAt: ago(45),
    },
];

export const MOCK_SYSTEM_STATUS: SystemSyncStatus[] = [
    {
        plugin: 'github',
        lastSuccessfulSync: ago(5),
        pendingCount: 0,
        failedCount: 1,
        p50LatencyMs: 320,
        p95LatencyMs: 890,
    },
    {
        plugin: 'linear',
        lastSuccessfulSync: ago(2),
        pendingCount: 1,
        failedCount: 1,
        p50LatencyMs: 210,
        p95LatencyMs: 650,
    },
];

export const MOCK_MAPPING_CONFIG: MappingConfig = {
    statusMappings: {
        linear: [
            { externalStatus: 'Triage', outpostStatus: 'OPEN' },
            { externalStatus: 'Backlog', outpostStatus: 'OPEN' },
            { externalStatus: 'Todo', outpostStatus: 'OPEN' },
            { externalStatus: 'In Progress', outpostStatus: 'IN_PROGRESS' },
            { externalStatus: 'Done', outpostStatus: 'RESOLVED' },
            { externalStatus: 'Canceled', outpostStatus: 'CLOSED' },
        ],
        github: [
            { externalStatus: 'open', outpostStatus: 'OPEN' },
            { externalStatus: 'closed', outpostStatus: 'CLOSED' },
        ],
    },
    priorityMappings: {
        // Keys are the adapter's real lookup values — LinearAdapter maps with
        // String(data.priority), i.e. '0'..'4'. The human text lives in `label`. The
        // previous fixture used '0 (None)'-style keys, which is the unmatchable-key shape
        // #95 fixed on the persistence side; leaving it here would have re-canonicalized
        // the bug and left the editor's label rendering uncovered.
        linear: [
            { externalPriority: '0', outpostPriority: 'MEDIUM', label: 'None' },
            { externalPriority: '1', outpostPriority: 'CRITICAL', label: 'Urgent' },
            { externalPriority: '2', outpostPriority: 'HIGH', label: 'High' },
            { externalPriority: '3', outpostPriority: 'MEDIUM', label: 'Medium' },
            { externalPriority: '4', outpostPriority: 'LOW', label: 'Low' },
        ],
        github: [
            { externalPriority: 'critical', outpostPriority: 'CRITICAL' },
            { externalPriority: 'high', outpostPriority: 'HIGH' },
            { externalPriority: 'medium', outpostPriority: 'MEDIUM' },
            { externalPriority: 'low', outpostPriority: 'LOW' },
        ],
    },
    identityMappings: [
        {
            id: 'eid-1',
            externalPlugin: 'linear',
            externalUserId: 'lin-u1',
            externalDisplayName: 'Alice (Linear)',
            memberId: 'tm-1',
            memberName: 'Alice Martinez',
        },
        {
            id: 'eid-2',
            externalPlugin: 'linear',
            externalUserId: 'lin-u2',
            externalDisplayName: 'Bob (Linear)',
            memberId: 'tm-2',
            memberName: 'Bob Chen',
        },
        {
            id: 'eid-3',
            externalPlugin: 'github',
            externalUserId: 'gh-u1',
            externalDisplayName: 'alice-gh',
            memberId: 'tm-1',
            memberName: 'Alice Martinez',
        },
        {
            id: 'eid-4',
            externalPlugin: 'github',
            externalUserId: 'gh-u3',
            externalDisplayName: 'charlie-gh',
            memberId: null,
            memberName: null,
        },
    ],
    labelRules: {
        github: [
            { externalPrefix: 'priority:', outpostPrefix: '' },
            { externalPrefix: 'type:', outpostPrefix: '' },
            { externalPrefix: 'area/', outpostPrefix: '' },
        ],
        linear: [
            { externalPrefix: 'Priority: ', outpostPrefix: '' },
            { externalPrefix: 'Type: ', outpostPrefix: '' },
        ],
    },
};

// ─── Helpers ──────────────────────────────────────────────────────────────

export interface SyncEventFilters {
    sourcePlugin?: string;
    targetPlugin?: string;
    status?: SyncEventStatus;
    startDate?: string;
    endDate?: string;
}

export function filterSyncEvents(filters: SyncEventFilters): SyncEvent[] {
    let events = [...MOCK_SYNC_EVENTS];

    if (filters.sourcePlugin) {
        events = events.filter((e) => e.sourcePlugin === filters.sourcePlugin);
    }
    if (filters.targetPlugin) {
        events = events.filter((e) => e.targetPlugin === filters.targetPlugin);
    }
    if (filters.status) {
        events = events.filter((e) => e.status === filters.status);
    }
    if (filters.startDate) {
        const start = new Date(filters.startDate).getTime();
        events = events.filter((e) => new Date(e.createdAt).getTime() >= start);
    }
    if (filters.endDate) {
        const end = new Date(filters.endDate).getTime();
        events = events.filter((e) => new Date(e.createdAt).getTime() <= end);
    }

    return events.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

export function getUnresolvedConflicts(): SyncEvent[] {
    return MOCK_SYNC_EVENTS.filter(
        (e) => e.status === 'conflict' && !e.resolvedAt,
    ).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

/**
 * Determine health indicator color based on time since last successful sync.
 * green = <5 min, yellow = <30 min, red = >=30 min
 */
export function getSyncHealthColor(lastSuccessfulSync: string): 'green' | 'yellow' | 'red' {
    const elapsed = Date.now() - new Date(lastSuccessfulSync).getTime();
    const minutes = elapsed / 60_000;
    if (minutes < 5) return 'green';
    if (minutes < 30) return 'yellow';
    return 'red';
}
