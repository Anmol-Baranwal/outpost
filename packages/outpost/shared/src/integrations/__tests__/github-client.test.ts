import { describe, it, expect, vi } from 'vitest';
import { listCommentReactions } from '../github-client.js';

describe('listCommentReactions', () => {
    it('returns each reaction with its content and reactor login', async () => {
        const mockClient = {
            reactions: {
                listForIssueComment: vi.fn().mockResolvedValue({
                    data: [
                        { content: '+1', user: { login: 'reporter-user' } },
                        { content: '-1', user: { login: 'someone-else' } },
                    ],
                }),
            },
        };

        const result = await listCommentReactions(mockClient as never, 'owner', 'repo', 12345);

        expect(result).toEqual([
            { content: '+1', login: 'reporter-user' },
            { content: '-1', login: 'someone-else' },
        ]);
        expect(mockClient.reactions.listForIssueComment).toHaveBeenCalledWith({
            owner: 'owner',
            repo: 'repo',
            comment_id: 12345,
        });
    });
});
