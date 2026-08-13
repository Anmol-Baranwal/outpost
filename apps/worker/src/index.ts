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
 *
 * BOOT ORDER: /health starts listening before anything touches the database, so a
 * boot failure is reported rather than merely fatal. See the boot-state block below.
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
} from '@copilotkit/outpost/queue';
import { buildSyncEngine } from './build-sync-engine.js';
import { buildHealthResponse, summarizeBootError, type BootState } from './health.js';

// ─── Boot state ───────────────────────────────────────────────────────────

// Fail-fast on a bad boot is still the intent: a worker running with silently
// defaulted sync mappings would write wrong statuses to Linear, so it must not
// report itself healthy. What changed is that failing is no longer SILENT.
//
// This used to be a top-level `await buildSyncEngine()` above the health server,
// so any boot-time database problem killed the process before anything bound the
// port. Railway could only report "1/1 replicas never became healthy", which is
// indistinguishable from a broken image. That cost nine days of undiagnosed
// deploy failures when SystemConfig turned out to be missing from the production
// database: every deploy from 2026-08-07 failed with no usable signal.
//
// Now the port binds first and /health answers 503 with the reason while the boot
// is unfinished or failed. Railway still fails the deploy and keeps the previous
// replica — same outcome, diagnosable in seconds instead of days.
const boot: BootState = { phase: 'starting', error: null };

let worker: Worker | null = null;
let scheduler: Scheduler | null = null;

// ─── Health Server ────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? process.env.HEALTH_PORT ?? '3003', 10);

const healthServer = http.createServer((req, res) => {
    if (req.url !== '/health') {
        res.writeHead(404);
        res.end('Not Found');
        return;
    }

    const { statusCode, body } = buildHealthResponse(boot, worker ? worker.healthCheck() : null);
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
});

healthServer.listen(port, () => {
    console.log(`[Worker] Health server listening on port ${port} (boot: ${boot.phase})`);
});

// ─── Boot ─────────────────────────────────────────────────────────────────

// Everything that can throw at boot lives in here: buildSyncEngine's three
// database reads (the persisted status / priority / label mapping configs), the
// Worker construction, and the scheduler/worker start. Anything that escapes
// leaves boot.phase === 'failed' and the process ALIVE but unhealthy, so the
// reason reaches /health instead of vanishing with the process.
async function startWorker(): Promise<void> {
    const syncEngine = await buildSyncEngine();
    const handleTrackerSync = createTrackerSyncHandler(syncEngine);

    const started = new Worker({
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

    // ─── Register Handlers ────────────────────────────────────────────────
    started.on(JobType.AI_RESPONSE, handleAiResponse);
    started.on(JobType.ESCALATION, handleEscalation);
    started.on(JobType.SLA_CHECK, handleSlaCheck);
    started.on(JobType.ONBOARDING_DIGEST, handleOnboardingDigest);
    started.on(JobType.ACCOUNT_SCORING, handleAccountScoring);
    started.on(JobType.HUBSPOT_SYNC, handleHubSpotSync);
    started.on(JobType.TRACKER_SYNC, handleTrackerSync);
    started.on(JobType.JOB_CLEANUP, handleJobCleanup);
    started.on(JobType.GITHUB_REACTION_POLL, handleGithubReactionPoll);

    // Published before start() so a probe landing mid-start sees the real worker,
    // and so shutdown can stop it if a signal arrives during boot.
    worker = started;
    scheduler = new Scheduler();

    scheduler.start();
    started.start();
}

// NOTHING IS RETHROWN HERE, deliberately. This is a top-level-await entry
// module: an exception escaping module evaluation rejects its evaluation
// promise, which Node reports as an uncaught exception and exits on — a
// listening HTTP server does not keep the process alive. Rethrowing would kill
// the health server before it could answer a single probe and hand Railway the
// same bare "1/1 replicas never became healthy" that hid a missing SystemConfig
// table for nine days. Staying up and answering 503 IS the fix.
//
// Fail-fast is still the intent: a worker whose sync mappings could not be read
// must never be reported healthy, because TRACKER_SYNC would write wrong
// statuses to Linear. Railway fails the deploy on the failing healthcheck and
// keeps the previous replica serving — same outcome, with a reason attached.
try {
    await startWorker();
    boot.phase = 'ready';
    console.log('[Worker] Worker process started');
} catch (error) {
    boot.error = summarizeBootError(error);
    boot.phase = 'failed';
    // The full error goes to the logs only — /health carries the redacted form,
    // since Prisma's connectivity errors quote the database host, port and user.
    console.error('[Worker] BOOT FAILED:', error);
    console.error(
        `[Worker] The process stays up so /health on ${port} reports 503 ("${boot.error}"). ` +
            `A missing table or column here means the database does not match schema.prisma — ` +
            `check the schema-drift guard in apps/worker/start.sh.`,
    );
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
    console.log(`[Worker] Received ${signal}, shutting down...`);
    scheduler?.stop();
    await worker?.stop();
    healthServer.close();
    await prisma.$disconnect();
    console.log('[Worker] Shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
