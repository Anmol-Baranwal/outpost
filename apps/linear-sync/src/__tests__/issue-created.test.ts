import { describe, it, expect } from 'vitest';
import { parseIssueCreated } from '../webhooks/issue-created.js';

function makeIssueCreatedPayload(overrides: Record<string, unknown> = {}) {
    return {
        action: 'create',
        type: 'Issue',
        data: {
            id: 'issue-abc-123',
            title: 'Fix login bug',
            description: 'Users cannot log in with SSO',
            state: { name: 'Todo' },
            priority: 2,
            priorityLabel: 'High',
            assigneeId: 'user-xyz',
            labels: [{ id: 'label-1', name: 'bug' }],
            teamId: 'team-001',
            createdAt: '2026-04-15T10:00:00.000Z',
            url: 'https://linear.app/team/issue/ABC-123',
            ...overrides,
        },
    };
}

describe('parseIssueCreated', () => {
    it('parses a full issue create event', () => {
        const payload = makeIssueCreatedPayload();
        const result = parseIssueCreated(payload);

        expect(result).toEqual({
            action: 'create',
            issueId: 'issue-abc-123',
            title: 'Fix login bug',
            description: 'Users cannot log in with SSO',
            status: 'Todo',
            priority: 2,
            priorityLabel: 'High',
            assigneeId: 'user-xyz',
            labels: [{ id: 'label-1', name: 'bug' }],
            teamId: 'team-001',
            createdAt: '2026-04-15T10:00:00.000Z',
            url: 'https://linear.app/team/issue/ABC-123',
        });
    });

    it('handles missing optional fields', () => {
        const payload = makeIssueCreatedPayload({
            description: null,
            state: null,
            assigneeId: null,
            labels: undefined,
        });
        // Remove labels from data to test undefined path
        delete (payload.data as Record<string, unknown>).labels;

        const result = parseIssueCreated(payload);

        expect(result.description).toBeNull();
        expect(result.status).toBeNull();
        expect(result.assigneeId).toBeNull();
        expect(result.labels).toEqual([]);
    });

    it('extracts assignee from nested assignee object', () => {
        const payload = makeIssueCreatedPayload({
            assigneeId: undefined,
            assignee: { id: 'user-nested' },
        });
        // Remove assigneeId to test fallback
        delete (payload.data as Record<string, unknown>).assigneeId;

        const result = parseIssueCreated(payload);
        expect(result.assigneeId).toBe('user-nested');
    });

    it('throws for non-Issue events', () => {
        const payload = {
            action: 'create',
            type: 'Comment',
            data: { id: '1', title: 'x', priority: 0, priorityLabel: 'None', teamId: 't', createdAt: '', url: '' },
        };

        expect(() => parseIssueCreated(payload)).toThrow('Expected Issue create event');
    });

    it('throws for non-create actions', () => {
        const payload = {
            action: 'update',
            type: 'Issue',
            data: { id: '1', title: 'x', priority: 0, priorityLabel: 'None', teamId: 't', createdAt: '', url: '' },
        };

        expect(() => parseIssueCreated(payload)).toThrow('Expected Issue create event');
    });

    it('throws for null payload', () => {
        expect(() => parseIssueCreated(null)).toThrow('not an object');
    });
});
