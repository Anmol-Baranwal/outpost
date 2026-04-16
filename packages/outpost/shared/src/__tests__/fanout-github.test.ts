/**
 * Tests for GitHub fan-out — pushing Outpost ticket changes to GitHub issues.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    fanoutStatusChange,
    fanoutComment,
    fanoutLabels,
    fanoutToGitHub,
    type GitHubFanoutDeps,
} from '../sync/fanout-github.js';
import { EchoGuard, type EchoGuardDeps } from '../sync/echo-guard.js';
import type { GitHubAdapter } from '../sync/adapters/github.js';
import type { TicketExternalLinkRef, TicketChange } from '../sync/types.js';
import { TicketStatus } from '../types.js';

// ─── Mock Factories ───────────────────────────────────────────────────────

function makeMockAdapter(): GitHubAdapter {
    return {
        name: 'github',
        pushStatusChange: vi.fn().mockResolvedValue(undefined),
        pushComment: vi.fn().mockResolvedValue(undefined),
        pushLabels: vi.fn().mockResolvedValue(undefined),
        onWebhookReceived: vi.fn().mockResolvedValue(null),
        mapStatusToOutpost: vi.fn().mockReturnValue(TicketStatus.OPEN),
        mapStatusFromOutpost: vi.fn().mockReturnValue('open'),
    } as unknown as GitHubAdapter;
}

function makeMockEchoGuard(): EchoGuard {
    const guard = {
        shouldSync: vi.fn().mockResolvedValue(true),
        recordSync: vi.fn().mockResolvedValue(undefined),
    };
    return guard as unknown as EchoGuard;
}

function makeDeps(): GitHubFanoutDeps {
    return {
        adapter: makeMockAdapter(),
        echoGuard: makeMockEchoGuard(),
    };
}

const sampleLink: TicketExternalLinkRef = {
    id: 'link-1',
    ticketId: 'tkt-1',
    plugin: 'github',
    externalId: 'org/repo#42',
    externalUrl: 'https://github.com/org/repo/issues/42',
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe('fanoutStatusChange', () => {
    let deps: GitHubFanoutDeps;

    beforeEach(() => {
        deps = makeDeps();
    });

    it('closes GitHub issue when status is CLOSED', async () => {
        const result = await fanoutStatusChange(deps, sampleLink, TicketStatus.CLOSED, 'linear');

        expect(result.pushed).toBe(true);
        expect(result.action).toBe('status_change');
        expect(deps.adapter.pushStatusChange).toHaveBeenCalledWith(sampleLink, TicketStatus.CLOSED);
    });

    it('reopens GitHub issue when status is OPEN', async () => {
        const result = await fanoutStatusChange(deps, sampleLink, TicketStatus.OPEN, 'linear');

        expect(result.pushed).toBe(true);
        expect(deps.adapter.pushStatusChange).toHaveBeenCalledWith(sampleLink, TicketStatus.OPEN);
    });

    it('skips push when echo is detected', async () => {
        vi.mocked(deps.echoGuard.shouldSync).mockResolvedValue(false);

        const result = await fanoutStatusChange(deps, sampleLink, TicketStatus.CLOSED, 'linear');

        expect(result.pushed).toBe(false);
        expect(result.skippedReason).toBe('echo detected');
        expect(deps.adapter.pushStatusChange).not.toHaveBeenCalled();
    });

    it('records success SyncEvent after push', async () => {
        await fanoutStatusChange(deps, sampleLink, TicketStatus.RESOLVED, 'linear');

        expect(deps.echoGuard.recordSync).toHaveBeenCalledWith(
            'linear', 'github', 'tkt-1', 'status_change', expect.any(String), 'success',
        );
    });

    it('records failure SyncEvent when push throws', async () => {
        vi.mocked(deps.adapter.pushStatusChange).mockRejectedValue(new Error('API 500'));

        const result = await fanoutStatusChange(deps, sampleLink, TicketStatus.CLOSED, 'linear');

        expect(result.pushed).toBe(false);
        expect(result.error).toBe('API 500');
        expect(deps.echoGuard.recordSync).toHaveBeenCalledWith(
            'linear', 'github', 'tkt-1', 'status_change', expect.any(String), 'failure', 'API 500',
        );
    });
});

describe('fanoutComment', () => {
    let deps: GitHubFanoutDeps;

    beforeEach(() => {
        deps = makeDeps();
    });

    it('posts comment on GitHub issue', async () => {
        const result = await fanoutComment(deps, sampleLink, 'Fixed in v2.0', 'linear');

        expect(result.pushed).toBe(true);
        expect(result.action).toBe('comment');
        expect(deps.adapter.pushComment).toHaveBeenCalledWith(sampleLink, 'Fixed in v2.0');
    });

    it('skips push when echo is detected', async () => {
        vi.mocked(deps.echoGuard.shouldSync).mockResolvedValue(false);

        const result = await fanoutComment(deps, sampleLink, 'hello', 'linear');

        expect(result.pushed).toBe(false);
        expect(deps.adapter.pushComment).not.toHaveBeenCalled();
    });
});

describe('fanoutLabels', () => {
    let deps: GitHubFanoutDeps;

    beforeEach(() => {
        deps = makeDeps();
    });

    it('updates labels on GitHub issue', async () => {
        const result = await fanoutLabels(deps, sampleLink, ['bug', 'priority:high'], 'linear');

        expect(result.pushed).toBe(true);
        expect(result.action).toBe('label_change');
        expect(deps.adapter.pushLabels).toHaveBeenCalledWith(sampleLink, ['bug', 'priority:high']);
    });
});

describe('fanoutToGitHub', () => {
    let deps: GitHubFanoutDeps;

    beforeEach(() => {
        deps = makeDeps();
    });

    it('dispatches status_change action', async () => {
        const change: TicketChange = {
            externalId: 'org/repo#42',
            action: 'status_change',
            status: TicketStatus.CLOSED,
        };

        const result = await fanoutToGitHub(deps, sampleLink, change, 'linear');

        expect(result.pushed).toBe(true);
        expect(deps.adapter.pushStatusChange).toHaveBeenCalled();
    });

    it('dispatches close action with status', async () => {
        const change: TicketChange = {
            externalId: 'org/repo#42',
            action: 'close',
            status: TicketStatus.CLOSED,
        };

        const result = await fanoutToGitHub(deps, sampleLink, change, 'linear');

        expect(result.pushed).toBe(true);
        expect(deps.adapter.pushStatusChange).toHaveBeenCalledWith(sampleLink, TicketStatus.CLOSED);
    });

    it('dispatches comment action', async () => {
        const change: TicketChange = {
            externalId: 'org/repo#42',
            action: 'comment',
            comment: 'Test comment',
        };

        const result = await fanoutToGitHub(deps, sampleLink, change, 'linear');

        expect(result.pushed).toBe(true);
        expect(deps.adapter.pushComment).toHaveBeenCalledWith(sampleLink, 'Test comment');
    });

    it('dispatches label_change action', async () => {
        const change: TicketChange = {
            externalId: 'org/repo#42',
            action: 'label_change',
            labels: ['bug'],
        };

        const result = await fanoutToGitHub(deps, sampleLink, change, 'linear');

        expect(result.pushed).toBe(true);
        expect(deps.adapter.pushLabels).toHaveBeenCalledWith(sampleLink, ['bug']);
    });

    it('returns skipped for unsupported actions', async () => {
        const change: TicketChange = {
            externalId: 'org/repo#42',
            action: 'priority_change',
        };

        const result = await fanoutToGitHub(deps, sampleLink, change, 'linear');

        expect(result.pushed).toBe(false);
        expect(result.skippedReason).toContain('unsupported');
    });

    it('returns skipped when status_change has no status', async () => {
        const change: TicketChange = {
            externalId: 'org/repo#42',
            action: 'status_change',
        };

        const result = await fanoutToGitHub(deps, sampleLink, change, 'linear');

        expect(result.pushed).toBe(false);
        expect(result.skippedReason).toBe('no status provided');
    });

    it('returns skipped when comment has no body', async () => {
        const change: TicketChange = {
            externalId: 'org/repo#42',
            action: 'comment',
        };

        const result = await fanoutToGitHub(deps, sampleLink, change, 'linear');

        expect(result.pushed).toBe(false);
        expect(result.skippedReason).toBe('no comment body');
    });
});
