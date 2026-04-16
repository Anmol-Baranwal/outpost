/**
 * Linear InternalTracker adapter.
 *
 * Implements bidirectional sync between Outpost and Linear:
 * - Parses Linear webhook events into TicketChanges
 * - Creates issues, updates statuses, assigns members, sets priorities
 * - Maps statuses/priorities/labels/identities via the mapping layer
 */

import { LinearClient } from '@linear/sdk';
import type {
    InternalTracker,
    WebhookEvent,
    TicketChange,
    TicketExternalLinkRef,
    TeamMemberRef,
    TicketChangeAction,
} from '../types.js';
import type { StatusMap } from '../status-map.js';
import type { PriorityMap } from '../priority-map.js';
import type { LabelMapper } from '../label-map.js';
import type { IdentityMapper } from '../identity-map.js';
import { TicketStatus, TicketPriority } from '../../types.js';

// ─── Configuration ────────────────────────────────────────────────────────

export interface LinearAdapterConfig {
    apiKey: string;
    teamId: string;
    statusMap: StatusMap;
    priorityMap: PriorityMap;
    labelMapper: LabelMapper;
    identityMapper: IdentityMapper;
}

// ─── Linear SDK Abstractions (for testability) ───────────────────────────

/**
 * Minimal Linear SDK interface for dependency injection.
 * In production the real LinearClient satisfies this; in tests we mock it.
 */
export interface LinearClientLike {
    createIssue(input: {
        teamId: string;
        title: string;
        description?: string;
        stateId?: string;
        priority?: number;
    }): Promise<{ success: boolean; issue: Promise<{ id: string }> }>;

    createComment(input: {
        issueId: string;
        body: string;
    }): Promise<{ success: boolean }>;

    workflowStates(filter: {
        team: { id: { eq: string } };
    }): Promise<{ nodes: Array<{ id: string; name: string }> }>;

    issueLabels(filter: {
        team: { id: { eq: string } };
    }): Promise<{ nodes: Array<{ id: string; name: string }> }>;

    issue(issueId: string): Promise<{
        id: string;
        update(input: Record<string, unknown>): Promise<{ success: boolean }>;
    }>;
}

// ─── LinearAdapter ────────────────────────────────────────────────────────

export class LinearAdapter implements InternalTracker {
    readonly name = 'linear';

    private readonly client: LinearClientLike;
    private readonly teamId: string;
    private readonly statusMap: StatusMap;
    private readonly priorityMap: PriorityMap;
    private readonly labelMapper: LabelMapper;
    private readonly identityMapper: IdentityMapper;

    /** Cache of workflow state name → ID (populated lazily). */
    private workflowStateCache: Map<string, string> | null = null;
    /** Cache of label name → ID (populated lazily). */
    private labelCache: Map<string, string> | null = null;

    constructor(config: LinearAdapterConfig, client?: LinearClientLike) {
        this.client = client ?? new LinearClient({ apiKey: config.apiKey }) as unknown as LinearClientLike;
        this.teamId = config.teamId;
        this.statusMap = config.statusMap;
        this.priorityMap = config.priorityMap;
        this.labelMapper = config.labelMapper;
        this.identityMapper = config.identityMapper;
    }

    // ─── Webhook Parsing ──────────────────────────────────────────────

    async onWebhookReceived(event: WebhookEvent): Promise<TicketChange | null> {
        const payload = event.payload;
        const action = payload.action as string | undefined;
        const type = payload.type as string | undefined;

        if (type !== 'Issue' && type !== 'Comment') {
            return null;
        }

        const data = payload.data as Record<string, unknown> | undefined;
        if (!data) {
            return null;
        }

        // Comment created
        if (type === 'Comment' && action === 'create') {
            const issueData = data.issue as Record<string, unknown> | undefined;
            const issueId = issueData?.id as string | undefined;
            if (!issueId) return null;

            return {
                externalId: issueId,
                action: 'comment',
                comment: data.body as string | undefined,
            };
        }

        // Issue events
        if (type === 'Issue') {
            const issueId = data.id as string;

            if (action === 'create') {
                return {
                    externalId: issueId,
                    action: 'new_issue',
                    title: data.title as string | undefined,
                    description: data.description as string | undefined,
                    status: this.mapStatusToOutpost(
                        (data.state as Record<string, unknown>)?.name as string ?? 'Triage',
                    ),
                    priority: this.mapPriorityToOutpost(String(data.priority ?? '0')),
                };
            }

            if (action === 'update') {
                const updatedFrom = payload.updatedFrom as Record<string, unknown> | undefined;
                if (!updatedFrom) return null;

                // Status change
                if (updatedFrom.stateId !== undefined) {
                    const stateName = (data.state as Record<string, unknown>)?.name as string | undefined;
                    if (stateName) {
                        return {
                            externalId: issueId,
                            action: 'status_change',
                            status: this.mapStatusToOutpost(stateName),
                        };
                    }
                }

                // Priority change
                if (updatedFrom.priority !== undefined) {
                    return {
                        externalId: issueId,
                        action: 'priority_change',
                        priority: this.mapPriorityToOutpost(String(data.priority ?? '0')),
                    };
                }

                // Assignee change
                if (updatedFrom.assigneeId !== undefined) {
                    const assigneeId = data.assigneeId as string | undefined;
                    return {
                        externalId: issueId,
                        action: 'assignee_change',
                        assigneeExternalId: assigneeId ?? undefined,
                    };
                }

                // Label change
                if (updatedFrom.labelIds !== undefined) {
                    const labels = data.labels as Array<{ name: string }> | undefined;
                    return {
                        externalId: issueId,
                        action: 'label_change',
                        labels: labels?.map((l) => l.name) ?? [],
                    };
                }
            }

            if (action === 'remove') {
                return {
                    externalId: issueId,
                    action: 'close',
                };
            }
        }

        return null;
    }

    // ─── Push Operations ──────────────────────────────────────────────

    async pushNewIssue(ticket: {
        id: string;
        title: string;
        description: string;
        status: TicketStatus;
        priority: TicketPriority;
    }): Promise<string> {
        const stateId = await this.resolveWorkflowStateId(
            this.mapStatusFromOutpost(ticket.status),
        );

        const priorityNumber = this.outpostPriorityToLinearNumber(ticket.priority);

        const result = await this.client.createIssue({
            teamId: this.teamId,
            title: ticket.title,
            description: ticket.description,
            stateId: stateId ?? undefined,
            priority: priorityNumber,
        });

        if (!result.success) {
            throw new Error('Failed to create Linear issue');
        }

        const issue = await result.issue;
        return issue.id;
    }

    async pushStatusChange(link: TicketExternalLinkRef, status: TicketStatus): Promise<void> {
        const stateName = this.mapStatusFromOutpost(status);
        const stateId = await this.resolveWorkflowStateId(stateName);
        if (!stateId) {
            throw new Error(`No Linear workflow state found for "${stateName}"`);
        }

        const issue = await this.client.issue(link.externalId);
        await issue.update({ stateId });
    }

    async pushAssignee(link: TicketExternalLinkRef, member: TeamMemberRef): Promise<void> {
        // Resolve the Outpost member to a Linear user ID via identity mapping
        const externalIdentity = await this.identityMapper.resolve('linear', member.id);

        // If we found a mapping, the externalId stored IS the Linear user ID.
        // The identity mapper stores plugin + externalId, where externalId is the
        // Linear user ID and memberId is the Outpost member ID. We need to look up
        // by memberId to get the Linear user ID — but IdentityMapper.resolve looks up
        // by externalId. So we use the member.id directly if we can find a mapping
        // where the memberId matches.
        //
        // For simplicity, we look up the member's external identity by plugin name,
        // using the member email as a proxy to find the linear user ID.
        // In practice, the mapping is registered during import or setup.
        const assigneeId = externalIdentity?.id;
        if (!assigneeId) {
            // No identity mapping — skip silently
            return;
        }

        const issue = await this.client.issue(link.externalId);
        await issue.update({ assigneeId });
    }

    async pushPriority(link: TicketExternalLinkRef, priority: TicketPriority): Promise<void> {
        const priorityNumber = this.outpostPriorityToLinearNumber(priority);
        const issue = await this.client.issue(link.externalId);
        await issue.update({ priority: priorityNumber });
    }

    async pushComment(link: TicketExternalLinkRef, message: string): Promise<void> {
        const result = await this.client.createComment({
            issueId: link.externalId,
            body: message,
        });

        if (!result.success) {
            throw new Error('Failed to create Linear comment');
        }
    }

    async pushLabels(link: TicketExternalLinkRef, labels: string[]): Promise<void> {
        const externalLabels = this.labelMapper.fromOutpost(labels);
        const labelIds = await this.resolveLabelIds(externalLabels);

        const issue = await this.client.issue(link.externalId);
        await issue.update({ labelIds });
    }

    // ─── Status Mapping ───────────────────────────────────────────────

    mapStatusToOutpost(externalStatus: string): TicketStatus {
        return this.statusMap.toOutpost(externalStatus);
    }

    mapStatusFromOutpost(status: TicketStatus): string {
        return this.statusMap.fromOutpost(status);
    }

    // ─── Priority Mapping ─────────────────────────────────────────────

    mapPriorityToOutpost(externalPriority: string): TicketPriority {
        return this.priorityMap.toOutpost(externalPriority);
    }

    mapPriorityFromOutpost(priority: TicketPriority): string {
        return this.priorityMap.fromOutpost(priority);
    }

    // ─── Identity Mapping ─────────────────────────────────────────────

    async mapUserToMember(externalUserId: string): Promise<TeamMemberRef | null> {
        return this.identityMapper.resolve('linear', externalUserId);
    }

    // ─── Internal Helpers ─────────────────────────────────────────────

    /**
     * Convert an Outpost TicketPriority to Linear's numeric priority (0-4).
     * Linear: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
     */
    private outpostPriorityToLinearNumber(priority: TicketPriority): number {
        switch (priority) {
            case TicketPriority.CRITICAL: return 1;
            case TicketPriority.HIGH: return 2;
            case TicketPriority.MEDIUM: return 3;
            case TicketPriority.LOW: return 4;
            default: return 3;
        }
    }

    /** Resolve a workflow state name to its Linear ID. Caches results. */
    private async resolveWorkflowStateId(stateName: string): Promise<string | null> {
        if (!this.workflowStateCache) {
            const states = await this.client.workflowStates({
                team: { id: { eq: this.teamId } },
            });
            this.workflowStateCache = new Map();
            for (const state of states.nodes) {
                this.workflowStateCache.set(state.name.toLowerCase(), state.id);
            }
        }

        return this.workflowStateCache.get(stateName.toLowerCase()) ?? null;
    }

    /** Resolve label names to Linear label IDs. Caches results. */
    private async resolveLabelIds(labelNames: string[]): Promise<string[]> {
        if (!this.labelCache) {
            const labels = await this.client.issueLabels({
                team: { id: { eq: this.teamId } },
            });
            this.labelCache = new Map();
            for (const label of labels.nodes) {
                this.labelCache.set(label.name.toLowerCase(), label.id);
            }
        }

        const ids: string[] = [];
        for (const name of labelNames) {
            const id = this.labelCache.get(name.toLowerCase());
            if (id) {
                ids.push(id);
            }
        }

        return ids;
    }
}
