import { describe, it, expect } from 'vitest';
import { parseIssueUpdated } from '../webhooks/issue-updated.js';

function makeIssueUpdatedPayload(
    dataOverrides: Record<string, unknown> = {},
    updatedFrom: Record<string, unknown> = {},
) {
    return {
        action: 'update',
        type: 'Issue',
        updatedFrom,
        data: {
            id: 'issue-abc-123',
            title: 'Updated title',
            state: { name: 'In Progress' },
            priority: 1,
            priorityLabel: 'Urgent',
            teamId: 'team-001',
            updatedAt: '2026-04-15T12:00:00.000Z',
            url: 'https://linear.app/team/issue/ABC-123',
            ...dataOverrides,
        },
    };
}

describe('parseIssueUpdated', () => {
    it('parses a full issue update event', () => {
        const payload = makeIssueUpdatedPayload(
            {},
            { title: 'Old title', stateId: 'old-state-id' },
        );
        const result = parseIssueUpdated(payload);

        expect(result.action).toBe('update');
        expect(result.issueId).toBe('issue-abc-123');
        expect(result.updatedFields).toEqual(['title', 'stateId']);
        expect(result.title).toBe('Updated title');
        expect(result.status).toBe('In Progress');
    });

    it('tracks partial updates correctly', () => {
        const payload = makeIssueUpdatedPayload(
            { assigneeId: 'user-new' },
            { assigneeId: null },
        );
        const result = parseIssueUpdated(payload);

        expect(result.updatedFields).toEqual(['assigneeId']);
        expect(result.assigneeId).toBe('user-new');
    });

    it('handles update with no updatedFrom field', () => {
        const payload = makeIssueUpdatedPayload();
        delete (payload as Record<string, unknown>).updatedFrom;

        const result = parseIssueUpdated(payload);
        expect(result.updatedFields).toEqual([]);
    });

    it('includes labels when labelIds changed in updatedFrom', () => {
        const payload = makeIssueUpdatedPayload(
            { labels: [{ id: 'l1', name: 'feature' }] },
            { labelIds: ['old-label-id'] },
        );
        const result = parseIssueUpdated(payload);

        expect(result.labels).toEqual([{ id: 'l1', name: 'feature' }]);
    });

    it('throws for non-Issue events', () => {
        const payload = {
            action: 'update',
            type: 'Comment',
            data: { id: '1', teamId: 't', updatedAt: '', url: '' },
        };

        expect(() => parseIssueUpdated(payload)).toThrow('Expected Issue update event');
    });

    it('throws for non-update actions', () => {
        const payload = {
            action: 'create',
            type: 'Issue',
            data: { id: '1', teamId: 't', updatedAt: '', url: '' },
        };

        expect(() => parseIssueUpdated(payload)).toThrow('Expected Issue update event');
    });
});
