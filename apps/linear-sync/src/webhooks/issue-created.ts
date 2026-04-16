/**
 * Parsed representation of a Linear Issue create event.
 */
export interface ParsedIssueCreated {
    action: 'create';
    issueId: string;
    title: string;
    description: string | null;
    status: string | null;
    priority: number;
    priorityLabel: string;
    assigneeId: string | null;
    labels: Array<{ id: string; name: string }>;
    teamId: string;
    createdAt: string;
    url: string;
}

/**
 * Raw Linear webhook payload shape for Issue events.
 * Kept intentionally loose — Linear may add fields over time.
 */
interface LinearIssueWebhookPayload {
    action: string;
    type: string;
    data: {
        id: string;
        title: string;
        description?: string | null;
        state?: { name: string } | null;
        priority: number;
        priorityLabel: string;
        assigneeId?: string | null;
        assignee?: { id: string } | null;
        labels?: Array<{ id: string; name: string }>;
        teamId: string;
        team?: { id: string };
        createdAt: string;
        url: string;
    };
}

/**
 * Parse a Linear Issue create webhook event into a normalized structure.
 *
 * @throws if the payload doesn't look like an Issue create event
 */
export function parseIssueCreated(payload: unknown): ParsedIssueCreated {
    const p = payload as LinearIssueWebhookPayload;

    if (!p || typeof p !== 'object') {
        throw new Error('Invalid webhook payload: not an object');
    }

    if (p.action !== 'create' || p.type !== 'Issue') {
        throw new Error(
            `Expected Issue create event, got ${p.type ?? 'unknown'} ${p.action ?? 'unknown'}`,
        );
    }

    const data = p.data;
    if (!data || !data.id || !data.title) {
        throw new Error('Invalid webhook payload: missing required issue fields');
    }

    return {
        action: 'create',
        issueId: data.id,
        title: data.title,
        description: data.description ?? null,
        status: data.state?.name ?? null,
        priority: data.priority,
        priorityLabel: data.priorityLabel,
        assigneeId: data.assigneeId ?? data.assignee?.id ?? null,
        labels: data.labels ?? [],
        teamId: data.teamId ?? data.team?.id ?? '',
        createdAt: data.createdAt,
        url: data.url,
    };
}
