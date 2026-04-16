import { describe, it, expect } from 'vitest';
import { parseCommentCreated } from '../webhooks/comment-created.js';

function makeCommentPayload(overrides: Record<string, unknown> = {}) {
    return {
        action: 'create',
        type: 'Comment',
        data: {
            id: 'comment-abc-123',
            body: 'This looks good, shipping it.',
            issueId: 'issue-xyz',
            userId: 'user-001',
            user: { id: 'user-001', name: 'Jordan' },
            createdAt: '2026-04-15T14:00:00.000Z',
            ...overrides,
        },
    };
}

describe('parseCommentCreated', () => {
    it('parses a full comment create event', () => {
        const payload = makeCommentPayload();
        const result = parseCommentCreated(payload);

        expect(result).toEqual({
            action: 'create',
            commentId: 'comment-abc-123',
            body: 'This looks good, shipping it.',
            issueId: 'issue-xyz',
            userId: 'user-001',
            userName: 'Jordan',
            createdAt: '2026-04-15T14:00:00.000Z',
        });
    });

    it('handles missing user name', () => {
        const payload = makeCommentPayload({
            user: { id: 'user-001' },
        });
        const result = parseCommentCreated(payload);

        expect(result.userId).toBe('user-001');
        expect(result.userName).toBeNull();
    });

    it('falls back to issue.id when issueId is missing', () => {
        const payload = makeCommentPayload({
            issueId: undefined,
            issue: { id: 'issue-fallback' },
        });
        delete (payload.data as Record<string, unknown>).issueId;

        const result = parseCommentCreated(payload);
        expect(result.issueId).toBe('issue-fallback');
    });

    it('handles missing user entirely', () => {
        const payload = makeCommentPayload({
            userId: undefined,
            user: undefined,
        });
        delete (payload.data as Record<string, unknown>).userId;
        delete (payload.data as Record<string, unknown>).user;

        const result = parseCommentCreated(payload);
        expect(result.userId).toBeNull();
        expect(result.userName).toBeNull();
    });

    it('throws for non-Comment events', () => {
        const payload = {
            action: 'create',
            type: 'Issue',
            data: { id: '1', body: 'x', createdAt: '' },
        };

        expect(() => parseCommentCreated(payload)).toThrow('Expected Comment create event');
    });

    it('throws for missing body', () => {
        const payload = {
            action: 'create',
            type: 'Comment',
            data: { id: '1', createdAt: '' },
        };

        expect(() => parseCommentCreated(payload)).toThrow('missing required comment fields');
    });

    it('throws for null payload', () => {
        expect(() => parseCommentCreated(null)).toThrow('not an object');
    });
});
