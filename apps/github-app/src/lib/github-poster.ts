import { ResponseFormatter } from '@copilotkit/outpost-ai';
import { AI_CONFIDENCE } from '@copilotkit/outpost-shared';
import { postIssueComment, postDiscussionComment } from './github-client.js';

const formatter = new ResponseFormatter();

export interface PostResponseOptions {
    /** The AI-generated response text (raw, pre-formatting) */
    responseText: string;
    /** Confidence score from the AI pipeline (0-1) */
    confidence: number;
    /** GitHub repo owner */
    owner: string;
    /** GitHub repo name */
    repo: string;
}

export interface IssuePostTarget {
    kind: 'issue';
    issueNumber: number;
}

export interface DiscussionPostTarget {
    kind: 'discussion';
    discussionNodeId: string;
}

export type PostTarget = IssuePostTarget | DiscussionPostTarget;

/**
 * Format and post an AI-generated response as a comment on a GitHub
 * issue or discussion.
 *
 * Adds a feedback section and a disclaimer for low-confidence responses.
 */
export async function postAiResponse(
    target: PostTarget,
    options: PostResponseOptions,
): Promise<void> {
    const { responseText, confidence, owner, repo } = options;

    const isLowConfidence = confidence < AI_CONFIDENCE.SUGGEST;

    const formatted = formatter.format(responseText, 'github', {
        addDisclaimer: isLowConfidence,
        disclaimerText:
            'This response has lower confidence. A team member will review shortly.',
    });

    const feedbackSection =
        '\n\n---\nWas this helpful? React with \uD83D\uDC4D or \uD83D\uDC4E';

    const body = formatted.text + feedbackSection;

    if (target.kind === 'issue') {
        await postIssueComment(owner, repo, target.issueNumber, body);
    } else {
        await postDiscussionComment(target.discussionNodeId, body);
    }
}
