import { describe, it, expect } from 'vitest';
import { DEFAULT_SCHEDULED_JOBS } from '../scheduler.js';
import { JobType } from '../types.js';

describe('DEFAULT_SCHEDULED_JOBS', () => {
    it('includes GITHUB_REACTION_POLL in the default scheduled jobs at a 24 hour interval', () => {
        const definition = DEFAULT_SCHEDULED_JOBS.find(
            (d) => d.type === JobType.GITHUB_REACTION_POLL,
        );
        expect(definition).toBeDefined();
        expect(definition!.intervalMs).toBe(24 * 60 * 60 * 1000);
    });

    it('schedules PENDING_RESPONSE_SWEEP every 5 minutes', () => {
        // Without a recurring schedule the sweep never runs, and a primary AI
        // response whose owning job dead-lettered stays PENDING forever — the
        // silence the responseState machine exists to prevent.
        const definition = DEFAULT_SCHEDULED_JOBS.find(
            (d) => d.type === JobType.PENDING_RESPONSE_SWEEP,
        );
        expect(definition).toBeDefined();
        expect(definition!.intervalMs).toBe(5 * 60 * 1000);
    });
});
