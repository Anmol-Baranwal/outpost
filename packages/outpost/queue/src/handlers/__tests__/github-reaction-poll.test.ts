import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMessageFindMany = vi.fn();
const mockMessageUpdate = vi.fn();
const mockCreateJob = vi.fn();
const mockListCommentReactions = vi.fn();
const mockCreateGithubClient = vi.fn().mockReturnValue({});

vi.mock('@copilotkit/outpost/db', () => ({
    prisma: {
        message: {
            findMany: (...args: unknown[]) => mockMessageFindMany(...args),
            update: (...args: unknown[]) => mockMessageUpdate(...args),
        },
    },
}));

vi.mock('@copilotkit/outpost/shared', () => ({
    createGithubClient: (...args: unknown[]) => mockCreateGithubClient(...args),
    listCommentReactions: (...args: unknown[]) => mockListCommentReactions(...args),
}));

vi.mock('../../create-job.js', () => ({
    createJob: (...args: unknown[]) => mockCreateJob(...args),
}));

import { handleGithubReactionPoll } from '../github-reaction-poll.js';
import { JobType } from '../../types.js';

const context = { reportProgress: vi.fn().mockResolvedValue(undefined), jobId: 'job-1' };

describe('handleGithubReactionPoll', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.GITHUB_APP_ID = 'app-1';
        process.env.GITHUB_PRIVATE_KEY = 'key';
        process.env.GITHUB_INSTALLATION_ID = '123';
    });

    it('sets POSITIVE feedback when the reporter reacted +1', async () => {
        mockMessageFindMany.mockResolvedValue([
            {
                id: 'msg-1',
                externalCommentId: '999',
                ticket: { sourceId: 'owner/repo#42', user: { externalId: 'reporter-login' } },
            },
        ]);
        mockListCommentReactions.mockResolvedValue([{ content: '+1', login: 'reporter-login' }]);

        const result = await handleGithubReactionPoll({}, context);

        expect(mockMessageUpdate).toHaveBeenCalledWith({
            where: { id: 'msg-1' },
            data: { feedback: 'POSITIVE' },
        });
        expect(mockCreateJob).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
    });

    it('sets NEGATIVE feedback and enqueues ESCALATION when the reporter reacted -1', async () => {
        mockMessageFindMany.mockResolvedValue([
            {
                id: 'msg-1',
                ticketId: 'ticket-1',
                externalCommentId: '999',
                ticket: { sourceId: 'owner/repo#42', user: { externalId: 'reporter-login' } },
            },
        ]);
        mockListCommentReactions.mockResolvedValue([{ content: '-1', login: 'reporter-login' }]);

        await handleGithubReactionPoll({}, context);

        expect(mockMessageUpdate).toHaveBeenCalledWith({
            where: { id: 'msg-1' },
            data: { feedback: 'NEGATIVE' },
        });
        expect(mockCreateJob).toHaveBeenCalledWith(JobType.ESCALATION, {
            ticketId: 'ticket-1',
            reason: expect.stringContaining('GitHub reaction'),
        });
    });

    it('ignores a reaction from someone other than the reporter', async () => {
        mockMessageFindMany.mockResolvedValue([
            {
                id: 'msg-1',
                externalCommentId: '999',
                ticket: { sourceId: 'owner/repo#42', user: { externalId: 'reporter-login' } },
            },
        ]);
        mockListCommentReactions.mockResolvedValue([{ content: '+1', login: 'someone-else' }]);

        await handleGithubReactionPoll({}, context);

        expect(mockMessageUpdate).not.toHaveBeenCalled();
    });

    it('skips a message with no externalCommentId', async () => {
        mockMessageFindMany.mockResolvedValue([
            {
                id: 'msg-1',
                externalCommentId: null,
                ticket: { sourceId: 'owner/repo#42', user: { externalId: 'reporter-login' } },
            },
        ]);

        await handleGithubReactionPoll({}, context);

        expect(mockListCommentReactions).not.toHaveBeenCalled();
        expect(mockMessageUpdate).not.toHaveBeenCalled();
    });

    it('catches a listCommentReactions rejection, logs, and continues without updating', async () => {
        mockMessageFindMany.mockResolvedValue([
            {
                id: 'msg-1',
                externalCommentId: '999',
                ticket: { sourceId: 'owner/repo#42', user: { externalId: 'reporter-login' } },
            },
        ]);
        mockListCommentReactions.mockRejectedValue(new Error('GitHub API down'));
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const result = await handleGithubReactionPoll({}, context);

        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(mockMessageUpdate).not.toHaveBeenCalled();
        expect(mockCreateJob).not.toHaveBeenCalled();
        expect(result.success).toBe(true);

        consoleErrorSpy.mockRestore();
    });

    it('returns a failure result and skips GitHub calls when env vars are missing', async () => {
        delete process.env.GITHUB_APP_ID;
        delete process.env.GITHUB_PRIVATE_KEY;
        delete process.env.GITHUB_INSTALLATION_ID;
        mockMessageFindMany.mockResolvedValue([
            {
                id: 'msg-1',
                externalCommentId: '999',
                ticket: { sourceId: 'owner/repo#42', user: { externalId: 'reporter-login' } },
            },
        ]);

        const result = await handleGithubReactionPoll({}, context);

        expect(result).toEqual({
            success: false,
            error: 'GITHUB_APP_ID/GITHUB_PRIVATE_KEY/GITHUB_INSTALLATION_ID not configured',
        });
        expect(mockCreateGithubClient).not.toHaveBeenCalled();
        expect(mockListCommentReactions).not.toHaveBeenCalled();
    });

    it('queries only unresolved AI-generated GitHub messages', async () => {
        mockMessageFindMany.mockResolvedValue([]);

        await handleGithubReactionPoll({}, context);

        expect(mockMessageFindMany).toHaveBeenCalledWith({
            where: {
                isAiGenerated: true,
                feedback: null,
                externalCommentId: { not: null },
                ticket: {
                    source: { in: ['GITHUB_ISSUE'] },
                },
            },
            include: {
                ticket: {
                    select: {
                        id: true,
                        sourceId: true,
                        user: { select: { externalId: true } },
                    },
                },
            },
        });
    });
});
