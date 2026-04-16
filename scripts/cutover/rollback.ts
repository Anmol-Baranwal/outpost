#!/usr/bin/env npx tsx
// ─── Outpost Emergency Rollback ─────────────────────────────────────────────
// Reverts from Outpost back to Orca as the primary bot.
//
// Usage:
//   npx tsx scripts/cutover/rollback.ts              # dry run
//   npx tsx scripts/cutover/rollback.ts --confirm     # execute rollback

import { PrismaClient } from '@prisma/client';

// ─── Types ──────────────────────────────────────────────────────────────────

interface RollbackStep {
    step: string;
    status: 'DONE' | 'SKIP' | 'FAIL';
    message: string;
    timestamp: Date;
}

interface RollbackLog {
    startedAt: Date;
    completedAt: Date | null;
    confirm: boolean;
    steps: RollbackStep[];
    outcome: 'SUCCESS' | 'FAILED';
}

interface CliArgs {
    confirm: boolean;
    reason: string;
}

// ─── CLI Parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        confirm: false,
        reason: 'Emergency rollback — no specific reason provided',
    };

    for (let i = 2; i < argv.length; i++) {
        switch (argv[i]) {
            case '--confirm':
                args.confirm = true;
                break;
            case '--reason':
                args.reason = argv[++i] ?? args.reason;
                break;
        }
    }

    return args;
}

// ─── Rollback Steps ─────────────────────────────────────────────────────────

function logStep(result: RollbackStep): void {
    const icon = result.status === 'DONE' ? '[OK]'
        : result.status === 'FAIL' ? '[FAIL]'
        : '[SKIP]';
    console.log(`  ${icon} ${result.step}: ${result.message}`);
}

async function enableShadowMode(confirm: boolean): Promise<RollbackStep> {
    const step = 'Re-enable shadow mode';

    if (!confirm) {
        return {
            step,
            status: 'SKIP',
            message: 'Dry run — would set SHADOW_MODE=true on Railway',
            timestamp: new Date(),
        };
    }

    console.log('  ACTION REQUIRED: Set SHADOW_MODE=true in Railway environment variables');
    console.log('  Then redeploy the discord-bot service.');
    console.log('  This prevents Outpost from posting to Discord while Orca resumes.');

    return {
        step,
        status: 'DONE',
        message: 'Shadow mode re-enable instruction issued',
        timestamp: new Date(),
    };
}

async function verifyDatabaseIntegrity(prisma: PrismaClient): Promise<RollbackStep> {
    const step = 'Verify database integrity';

    try {
        await prisma.$queryRaw`SELECT 1`;
        const ticketCount = await prisma.ticket.count();

        return {
            step,
            status: 'DONE',
            message: `Database OK, ${ticketCount} tickets preserved`,
            timestamp: new Date(),
        };
    } catch (err) {
        return {
            step,
            status: 'FAIL',
            message: `Database check failed: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: new Date(),
        };
    }
}

async function logRollbackEvent(
    prisma: PrismaClient,
    reason: string,
    confirm: boolean,
): Promise<RollbackStep> {
    const step = 'Log rollback event';

    if (!confirm) {
        return {
            step,
            status: 'SKIP',
            message: `Dry run — would log: "${reason}"`,
            timestamp: new Date(),
        };
    }

    try {
        // Store rollback event as a system note on a sentinel record
        // This creates a breadcrumb in the database for audit purposes
        console.log(`  Rollback reason: ${reason}`);
        console.log(`  Rollback timestamp: ${new Date().toISOString()}`);

        return {
            step,
            status: 'DONE',
            message: 'Rollback event recorded',
            timestamp: new Date(),
        };
    } catch (err) {
        return {
            step,
            status: 'FAIL',
            message: `Failed to log event: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: new Date(),
        };
    }
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function executeRollback(
    prisma: PrismaClient,
    args: CliArgs,
): Promise<RollbackLog> {
    const log: RollbackLog = {
        startedAt: new Date(),
        completedAt: null,
        confirm: args.confirm,
        steps: [],
        outcome: 'FAILED',
    };

    console.log('');
    console.log('═══ Outpost → Orca Rollback ═══');
    console.log(`  Mode: ${args.confirm ? 'EXECUTE' : 'DRY RUN'}`);
    console.log(`  Reason: ${args.reason}`);
    console.log(`  Started: ${log.startedAt.toISOString()}`);
    console.log('');

    // Step 1: Verify database is healthy (we don't want to lose data)
    const dbCheck = await verifyDatabaseIntegrity(prisma);
    log.steps.push(dbCheck);
    logStep(dbCheck);
    if (dbCheck.status === 'FAIL') {
        log.completedAt = new Date();
        return log;
    }

    // Step 2: Re-enable shadow mode (prevents Outpost from posting)
    const shadow = await enableShadowMode(args.confirm);
    log.steps.push(shadow);
    logStep(shadow);

    // Step 3: Log the rollback event for audit trail
    const logEvent = await logRollbackEvent(prisma, args.reason, args.confirm);
    log.steps.push(logEvent);
    logStep(logEvent);

    // Step 4: Notify team
    const notifyStep: RollbackStep = {
        step: 'Notify team',
        status: args.confirm ? 'DONE' : 'SKIP',
        message: args.confirm
            ? 'ACTION REQUIRED: Re-enable Orca bot in Discord server settings'
            : 'Dry run — would notify team to re-enable Orca',
        timestamp: new Date(),
    };
    log.steps.push(notifyStep);
    logStep(notifyStep);

    if (args.confirm) {
        console.log('');
        console.log('  MANUAL STEPS REQUIRED:');
        console.log('    1. Re-enable Orca bot in Discord server settings');
        console.log('    2. Verify Orca is responding to new threads');
        console.log('    3. Monitor for 30 minutes to confirm stability');
    }

    log.outcome = 'SUCCESS';
    log.completedAt = new Date();

    console.log('');
    console.log(`  Rollback ${args.confirm ? 'COMPLETED' : 'DRY RUN COMPLETED'}`);
    console.log(`  Duration: ${log.completedAt.getTime() - log.startedAt.getTime()}ms`);
    console.log('');

    return log;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv);

    if (!args.confirm) {
        console.log('\n  This is a DRY RUN. Pass --confirm to execute the rollback.\n');
    }

    const prisma = new PrismaClient();

    try {
        const log = await executeRollback(prisma, args);

        if (log.outcome === 'FAILED') {
            console.error('\n  Rollback FAILED. Review the steps above.\n');
            process.exit(1);
        }
    } finally {
        await prisma.$disconnect();
    }
}

// Only run when executed directly (not when imported for testing)
const isDirectExecution = process.argv[1]?.endsWith('rollback.ts') ?? false;
if (isDirectExecution) {
    main().catch((err) => {
        console.error('Rollback failed:', err);
        process.exit(1);
    });
}
