import { vi } from 'vitest';

/**
 * Shared mock for @copilotkit/outpost/db used across discord-bot tests.
 *
 * Call vi.mock('@copilotkit/outpost/db', () => mockPrisma()) at the top
 * of each test file. This keeps the mock shape in one place so all tests
 * stay consistent when the schema changes.
 */
export function mockPrisma(): Record<string, unknown> {
    return {
        prisma: {
            ticket: {
                create: vi.fn(),
                findFirst: vi.fn(),
                findUnique: vi.fn(),
                update: vi.fn(),
                count: vi.fn(),
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
            onboardingMember: {
                upsert: vi.fn(),
            },
        },
    };
}

/**
 * Shared mock for @copilotkit/outpost/queue used across discord-bot tests.
 */
export function mockQueue(): Record<string, unknown> {
    return {
        createJob: vi.fn().mockResolvedValue('job-123'),
        JobType: {
            AI_RESPONSE: 'AI_RESPONSE',
            TICKET_CLASSIFY: 'TICKET_CLASSIFY',
            SLA_CHECK: 'SLA_CHECK',
            ESCALATION: 'ESCALATION',
            ONBOARDING_DIGEST: 'ONBOARDING_DIGEST',
            ACCOUNT_SCORING: 'ACCOUNT_SCORING',
            HUBSPOT_SYNC: 'HUBSPOT_SYNC',
        },
    };
}
