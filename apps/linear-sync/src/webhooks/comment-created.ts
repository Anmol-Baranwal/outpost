/**
 * Parsed representation of a Linear Comment create event.
 */
export interface ParsedCommentCreated {
    action: 'create';
    commentId: string;
    body: string;
    issueId: string;
    userId: string | null;
    userName: string | null;
    createdAt: string;
}

/**
 * Raw Linear webhook payload shape for Comment create events.
 */
interface LinearCommentWebhookPayload {
    action: string;
    type: string;
    data: {
        id: string;
        body: string;
        issueId?: string;
        issue?: { id: string };
        userId?: string;
        user?: { id: string; name?: string };
        createdAt: string;
    };
}

/**
 * Parse a Linear Comment create webhook event into a normalized structure.
 *
 * @throws if the payload doesn't look like a Comment create event
 */
export function parseCommentCreated(payload: unknown): ParsedCommentCreated {
    const p = payload as LinearCommentWebhookPayload;

    if (!p || typeof p !== 'object') {
        throw new Error('Invalid webhook payload: not an object');
    }

    if (p.action !== 'create' || p.type !== 'Comment') {
        throw new Error(
            `Expected Comment create event, got ${p.type ?? 'unknown'} ${p.action ?? 'unknown'}`,
        );
    }

    const data = p.data;
    if (!data || !data.id || !data.body) {
        throw new Error('Invalid webhook payload: missing required comment fields');
    }

    return {
        action: 'create',
        commentId: data.id,
        body: data.body,
        issueId: data.issueId ?? data.issue?.id ?? '',
        userId: data.userId ?? data.user?.id ?? null,
        userName: data.user?.name ?? null,
        createdAt: data.createdAt,
    };
}
