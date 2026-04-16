import { vi } from 'vitest';

/**
 * Shared mock for @copilotkit/outpost/db used across github-app tests.
 */
export function mockPrisma(): Record<string, unknown> {
    return {
        prisma: {
            ticket: {
                create: vi.fn(),
                findFirst: vi.fn(),
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
            ticketExternalLink: {
                create: vi.fn(),
                findUnique: vi.fn(),
            },
        },
    };
}

/**
 * Shared mock for @copilotkit/outpost/queue used across github-app tests.
 */
export function mockQueue(): Record<string, unknown> {
    return {
        createJob: vi.fn().mockResolvedValue('job-123'),
        JobType: {
            AI_RESPONSE: 'AI_RESPONSE',
            TICKET_CLASSIFY: 'TICKET_CLASSIFY',
        },
    };
}
