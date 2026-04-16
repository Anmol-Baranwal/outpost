import { vi } from 'vitest';

/**
 * Shared mock for @copilotkit/outpost/db used across teams-bot tests.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function mockPrisma(): Record<string, unknown> {
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
 * Shared mock for @copilotkit/outpost/queue used across teams-bot tests.
 */
export function mockQueue(): Record<string, unknown> {
    return {
        createJob: vi.fn().mockResolvedValue('job-123'),
        JobType: {
            AI_RESPONSE: 'AI_RESPONSE',
            ESCALATION: 'ESCALATION',
        },
    };
}
