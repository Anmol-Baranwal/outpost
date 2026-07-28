/**
 * Outpost Worker Process
 *
 * The background job processor for Outpost. Boots a Worker (which polls
 * the Postgres job queue) and a Scheduler (which creates recurring jobs
 * on fixed intervals), then exposes a /health endpoint for Railway.
 *
 * Job types and their handlers:
 *   - AI_RESPONSE:      Generate AI support response (pipeline + classification)
 *   - ESCALATION:       Route ticket to a human, post notification
 *   - SLA_CHECK:        Periodic compliance check, flag breaches
 *   - ONBOARDING_DIGEST: Daily new-member digest
 *   - ACCOUNT_SCORING:  Sentiment + engagement analysis
 *   - HUBSPOT_SYNC:     CRM sync
 *   - TRACKER_SYNC:     Push changes to external trackers
 *   - JOB_CLEANUP:      Periodic cleanup of old jobs and sync events
 *   - GITHUB_REACTION_POLL: Poll GitHub reactions on AI comments (no webhook exists)
 */

import http from 'node:http';
import { prisma } from '@copilotkit/outpost/db';
import {
    Worker,
    Scheduler,
    JobType,
    handleAiResponse,
    handleEscalation,
    handleSlaCheck,
    handleOnboardingDigest,
    handleAccountScoring,
    handleHubSpotSync,
    createTrackerSyncHandler,
    handleJobCleanup,
    handleGithubReactionPoll,
    createJob,
} from '@copilotkit/outpost/queue';
import { SyncEngine } from '@copilotkit/outpost/shared';
import type { SyncEngineDeps } from '@copilotkit/outpost/shared';

// ─── Build SyncEngine for TRACKER_SYNC handler ────────────────────────────

// SyncEngineDeps describes only the slice of Prisma the engine needs, using loose
// Record<string, unknown> argument shapes. The real PrismaClient and createJob have
// narrower signatures, so they are not assignable in the strict direction — the
// coercion is deliberate. Asserting to the named dep types rather than `any` keeps
// that intent explicit and makes the cast break loudly if SyncEngineDeps changes.
const syncEngine = new SyncEngine({
    prisma: prisma as unknown as SyncEngineDeps['prisma'],
    createJob: createJob as SyncEngineDeps['createJob'],
});

const handleTrackerSync = createTrackerSyncHandler(syncEngine);

// ─── Create Worker ────────────────────────────────────────────────────────

const worker = new Worker({
    maxConcurrency: 10,
    pollIntervalMs: 1000,
    concurrencyByType: {
        [JobType.AI_RESPONSE]: 4,
        [JobType.ESCALATION]: 2,
        [JobType.SLA_CHECK]: 1,
        [JobType.ONBOARDING_DIGEST]: 1,
        [JobType.ACCOUNT_SCORING]: 1,
        [JobType.HUBSPOT_SYNC]: 1,
        [JobType.TRACKER_SYNC]: 1,
        [JobType.JOB_CLEANUP]: 1,
        [JobType.GITHUB_REACTION_POLL]: 1,
    },
    jobTimeouts: {
        [JobType.AI_RESPONSE]: 120_000, // 2 minutes — AI pipeline is slow
        [JobType.HUBSPOT_SYNC]: 300_000, // 5 minutes — full sync can be large
        [JobType.ACCOUNT_SCORING]: 300_000, // 5 minutes — many accounts
    },
});

// ─── Register Handlers ────────────────────────────────────────────────────

worker.on(JobType.AI_RESPONSE, handleAiResponse);
worker.on(JobType.ESCALATION, handleEscalation);
worker.on(JobType.SLA_CHECK, handleSlaCheck);
worker.on(JobType.ONBOARDING_DIGEST, handleOnboardingDigest);
worker.on(JobType.ACCOUNT_SCORING, handleAccountScoring);
worker.on(JobType.HUBSPOT_SYNC, handleHubSpotSync);
worker.on(JobType.TRACKER_SYNC, handleTrackerSync);
worker.on(JobType.JOB_CLEANUP, handleJobCleanup);
worker.on(JobType.GITHUB_REACTION_POLL, handleGithubReactionPoll);

// ─── Start Scheduler ──────────────────────────────────────────────────────

const scheduler = new Scheduler();

// ─── Health Server ────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? process.env.HEALTH_PORT ?? '3003', 10);

const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
        const health = worker.healthCheck();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', ...health }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// ─── Start Everything ─────────────────────────────────────────────────────

healthServer.listen(port, () => {
    console.log(`[Worker] Health server listening on port ${port}`);
});

scheduler.start();
worker.start();

console.log('[Worker] Worker process started');

// ─── Graceful Shutdown ────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
    console.log(`[Worker] Received ${signal}, shutting down...`);
    scheduler.stop();
    await worker.stop();
    healthServer.close();
    await prisma.$disconnect();
    console.log('[Worker] Shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
