import { vi } from 'vitest';

/**
 * Shared mock for @copilotkit/outpost/db used across slack-bot tests.
 */
export function mockPrisma() {
    return {
        prisma: {
            ticket: {
                create: vi.fn(),
                findFirst: vi.fn(),
                findUnique: vi.fn(),
                update: vi.fn(),
            },
            message: {
                create: vi.fn(),
            },
            note: {
                create: vi.fn(),
            },
            user: {
                findFirst: vi.fn(),
            },
            teamMember: {
                findUnique: vi.fn(),
            },
        },
    };
}

/**
 * Shared mock for @copilotkit/outpost/queue used across slack-bot tests.
 */
export function mockQueue() {
    return {
        createJob: vi.fn().mockResolvedValue('job-123'),
        JobType: {
            AI_RESPONSE: 'AI_RESPONSE',
            ESCALATION: 'ESCALATION',
        },
    };
}
