/**
 * GitHub fan-out — pushes Outpost ticket changes to GitHub issues.
 *
 * When an Outpost ticket is updated (from any source — Linear, web UI,
 * AI classification, etc.), and the ticket has an external link to GitHub
 * (externalTracker='github'), this module pushes the changes via the
 * GitHubAdapter's push methods.
 *
 * This is called by the sync hooks (Phase 2) or directly by the
 * TRACKER_SYNC job handler. The fan-out functions are stateless —
 * they receive the adapter and link reference and execute the push.
 */

import type { GitHubAdapter } from './adapters/github.js';
import type { TicketExternalLinkRef, TicketChange } from './types.js';
import type { TicketStatus } from '../types.js';
import { EchoGuard } from './echo-guard.js';
import type { EchoGuardDeps } from './echo-guard.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface GitHubFanoutDeps {
    adapter: GitHubAdapter;
    echoGuard: EchoGuard;
}

export interface GitHubFanoutResult {
    pushed: boolean;
    action: string;
    error?: string;
    skippedReason?: string;
}

// ─── Fan-Out Functions ────────────────────────────────────────────────────

/**
 * Push a status change to GitHub.
 * Maps Outpost status to GitHub open/closed state.
 */
export async function fanoutStatusChange(
    deps: GitHubFanoutDeps,
    link: TicketExternalLinkRef,
    status: TicketStatus,
    sourcePlugin: string,
): Promise<GitHubFanoutResult> {
    const hash = EchoGuard.computeHash({ entityId: link.ticketId, action: 'status_change', status });

    if (!await deps.echoGuard.shouldSync(sourcePlugin, 'github', link.ticketId, hash)) {
        return { pushed: false, action: 'status_change', skippedReason: 'echo detected' };
    }

    try {
        await deps.adapter.pushStatusChange(link, status);
        await deps.echoGuard.recordSync(
            sourcePlugin, 'github', link.ticketId, 'status_change', hash, 'success',
        );
        return { pushed: true, action: 'status_change' };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await deps.echoGuard.recordSync(
            sourcePlugin, 'github', link.ticketId, 'status_change', hash, 'failure', message,
        );
        return { pushed: false, action: 'status_change', error: message };
    }
}

/**
 * Push a comment to the GitHub issue.
 */
export async function fanoutComment(
    deps: GitHubFanoutDeps,
    link: TicketExternalLinkRef,
    comment: string,
    sourcePlugin: string,
): Promise<GitHubFanoutResult> {
    const hash = EchoGuard.computeHash({ entityId: link.ticketId, action: 'comment', comment });

    if (!await deps.echoGuard.shouldSync(sourcePlugin, 'github', link.ticketId, hash)) {
        return { pushed: false, action: 'comment', skippedReason: 'echo detected' };
    }

    try {
        await deps.adapter.pushComment(link, comment);
        await deps.echoGuard.recordSync(
            sourcePlugin, 'github', link.ticketId, 'comment', hash, 'success',
        );
        return { pushed: true, action: 'comment' };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await deps.echoGuard.recordSync(
            sourcePlugin, 'github', link.ticketId, 'comment', hash, 'failure', message,
        );
        return { pushed: false, action: 'comment', error: message };
    }
}

/**
 * Push label changes to the GitHub issue.
 */
export async function fanoutLabels(
    deps: GitHubFanoutDeps,
    link: TicketExternalLinkRef,
    labels: string[],
    sourcePlugin: string,
): Promise<GitHubFanoutResult> {
    const hash = EchoGuard.computeHash({ entityId: link.ticketId, action: 'label_change', labels });

    if (!await deps.echoGuard.shouldSync(sourcePlugin, 'github', link.ticketId, hash)) {
        return { pushed: false, action: 'label_change', skippedReason: 'echo detected' };
    }

    try {
        await deps.adapter.pushLabels(link, labels);
        await deps.echoGuard.recordSync(
            sourcePlugin, 'github', link.ticketId, 'label_change', hash, 'success',
        );
        return { pushed: true, action: 'label_change' };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await deps.echoGuard.recordSync(
            sourcePlugin, 'github', link.ticketId, 'label_change', hash, 'failure', message,
        );
        return { pushed: false, action: 'label_change', error: message };
    }
}

/**
 * Dispatch a TicketChange to the appropriate GitHub fan-out function.
 *
 * This is the main entry point used by the TRACKER_SYNC job handler
 * when the target plugin is 'github'.
 */
export async function fanoutToGitHub(
    deps: GitHubFanoutDeps,
    link: TicketExternalLinkRef,
    change: TicketChange,
    sourcePlugin: string,
): Promise<GitHubFanoutResult> {
    switch (change.action) {
        case 'status_change':
        case 'close':
            if (change.status) {
                return fanoutStatusChange(deps, link, change.status, sourcePlugin);
            }
            return { pushed: false, action: change.action, skippedReason: 'no status provided' };

        case 'comment':
            if (change.comment) {
                return fanoutComment(deps, link, change.comment, sourcePlugin);
            }
            return { pushed: false, action: 'comment', skippedReason: 'no comment body' };

        case 'label_change':
            if (change.labels) {
                return fanoutLabels(deps, link, change.labels, sourcePlugin);
            }
            return { pushed: false, action: 'label_change', skippedReason: 'no labels provided' };

        default:
            return { pushed: false, action: change.action, skippedReason: `unsupported action: ${change.action}` };
    }
}
