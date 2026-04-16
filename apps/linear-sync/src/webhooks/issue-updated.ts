/**
 * Parsed representation of a Linear Issue update event.
 */
export interface ParsedIssueUpdated {
    action: 'update';
    issueId: string;
    updatedFields: string[];
    title?: string;
    description?: string | null;
    status?: string | null;
    priority?: number;
    priorityLabel?: string;
    assigneeId?: string | null;
    labels?: Array<{ id: string; name: string }>;
    teamId: string;
    updatedAt: string;
    url: string;
}

/**
 * Raw Linear webhook payload shape for Issue update events.
 */
interface LinearIssueUpdatePayload {
    action: string;
    type: string;
    updatedFrom?: Record<string, unknown>;
    data: {
        id: string;
        title?: string;
        description?: string | null;
        state?: { name: string } | null;
        priority?: number;
        priorityLabel?: string;
        assigneeId?: string | null;
        assignee?: { id: string } | null;
        labels?: Array<{ id: string; name: string }>;
        teamId: string;
        team?: { id: string };
        updatedAt: string;
        url: string;
    };
}

/**
 * Parse a Linear Issue update webhook event into a normalized structure.
 *
 * The `updatedFrom` field in the payload tells us which fields changed —
 * it contains the *previous* values of those fields.
 *
 * @throws if the payload doesn't look like an Issue update event
 */
export function parseIssueUpdated(payload: unknown): ParsedIssueUpdated {
    const p = payload as LinearIssueUpdatePayload;

    if (!p || typeof p !== 'object') {
        throw new Error('Invalid webhook payload: not an object');
    }

    if (p.action !== 'update' || p.type !== 'Issue') {
        throw new Error(
            `Expected Issue update event, got ${p.type ?? 'unknown'} ${p.action ?? 'unknown'}`,
        );
    }

    const data = p.data;
    if (!data || !data.id) {
        throw new Error('Invalid webhook payload: missing required issue fields');
    }

    const updatedFields = p.updatedFrom ? Object.keys(p.updatedFrom) : [];

    const result: ParsedIssueUpdated = {
        action: 'update',
        issueId: data.id,
        updatedFields,
        teamId: data.teamId ?? data.team?.id ?? '',
        updatedAt: data.updatedAt,
        url: data.url,
    };

    // Only include fields that were actually changed
    if (data.title !== undefined) result.title = data.title;
    if (data.description !== undefined) result.description = data.description;
    if (data.state?.name !== undefined) result.status = data.state.name;
    if (data.priority !== undefined) result.priority = data.priority;
    if (data.priorityLabel !== undefined) result.priorityLabel = data.priorityLabel;
    if (data.assigneeId !== undefined || data.assignee?.id !== undefined) {
        result.assigneeId = data.assigneeId ?? data.assignee?.id ?? null;
    }
    if (data.labels !== undefined) result.labels = data.labels;

    return result;
}
