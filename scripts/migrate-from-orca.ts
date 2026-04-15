#!/usr/bin/env npx tsx
// ─── Orca → Outpost Migration Script ───────────────────────────────────────
// One-time migration of historical data from Orca (app.getorca.ai) to Outpost.
//
// Usage:
//   npx tsx scripts/migrate-from-orca.ts --input /path/to/orca-export.json
//   npx tsx scripts/migrate-from-orca.ts --input export.json --dry-run
//   npx tsx scripts/migrate-from-orca.ts --rollback --confirm

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { validateOrcaExport, type OrcaExport } from './lib/orca-types.js';
import {
    transformAccount,
    transformUser,
    transformTicket,
    transformMessage,
} from './lib/orca-transformer.js';
import {
    createReport,
    finalizeReport,
    formatReport,
    type MigrationReport,
} from './lib/migration-report.js';

// ─── CLI Argument Parsing ───────────────────────────────────────────────────

interface CliArgs {
    input: string | null;
    dryRun: boolean;
    rollback: boolean;
    confirm: boolean;
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        input: null,
        dryRun: false,
        rollback: false,
        confirm: false,
    };

    for (let i = 2; i < argv.length; i++) {
        switch (argv[i]) {
            case '--input':
                args.input = argv[++i] ?? null;
                break;
            case '--dry-run':
                args.dryRun = true;
                break;
            case '--rollback':
                args.rollback = true;
                break;
            case '--confirm':
                args.confirm = true;
                break;
        }
    }

    return args;
}

// ─── Display ID Generator ───────────────────────────────────────────────────

async function getNextDisplayIdCounter(prisma: PrismaClient): Promise<number> {
    const lastTicket = await prisma.ticket.findFirst({
        orderBy: { displayId: 'desc' },
        select: { displayId: true },
    });

    if (!lastTicket) return 1;

    const match = lastTicket.displayId.match(/^TKT-(\d+)$/);
    return match ? parseInt(match[1], 10) + 1 : 1;
}

function formatDisplayId(counter: number): string {
    return `TKT-${counter.toString().padStart(4, '0')}`;
}

// ─── Progress Reporting ─────────────────────────────────────────────────────

function logProgress(label: string, current: number, total: number): void {
    process.stdout.write(`\r  Migrating ${label}... ${current}/${total}`);
    if (current === total) {
        process.stdout.write('\n');
    }
}

// ─── Migration Logic ────────────────────────────────────────────────────────

async function migrateAccounts(
    prisma: PrismaClient,
    data: OrcaExport,
    report: MigrationReport,
    dryRun: boolean,
): Promise<Map<string, string>> {
    const orcaIdToOutpostId = new Map<string, string>();
    const total = data.accounts.length;

    for (let i = 0; i < total; i++) {
        const orcaAccount = data.accounts[i];
        logProgress('accounts', i + 1, total);

        try {
            const transformed = transformAccount(orcaAccount);

            if (dryRun) {
                orcaIdToOutpostId.set(orcaAccount.id, `dry-run-${orcaAccount.id}`);
                report.accounts.created++;
                continue;
            }

            // Check for existing account by name + domain to avoid duplicates
            const existing = await prisma.account.findFirst({
                where: {
                    name: transformed.name,
                    ...(transformed.domain ? { domain: transformed.domain } : {}),
                },
            });

            if (existing) {
                orcaIdToOutpostId.set(orcaAccount.id, existing.id);
                report.accounts.skipped++;
                continue;
            }

            const created = await prisma.account.create({
                data: transformed,
            });
            orcaIdToOutpostId.set(orcaAccount.id, created.id);
            report.accounts.created++;
        } catch (err) {
            report.accounts.failed++;
            report.accounts.errors.push({
                id: orcaAccount.id,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return orcaIdToOutpostId;
}

async function migrateUsers(
    prisma: PrismaClient,
    data: OrcaExport,
    report: MigrationReport,
    dryRun: boolean,
    accountMap: Map<string, string>,
): Promise<Map<string, string>> {
    const orcaIdToOutpostId = new Map<string, string>();
    const total = data.users.length;

    for (let i = 0; i < total; i++) {
        const orcaUser = data.users[i];
        logProgress('users', i + 1, total);

        try {
            const transformed = transformUser(orcaUser);

            if (dryRun) {
                orcaIdToOutpostId.set(orcaUser.id, `dry-run-${orcaUser.id}`);
                report.users.created++;
                continue;
            }

            // Check for existing user by email
            const existing = await prisma.user.findUnique({
                where: { email: transformed.email },
            });

            if (existing) {
                orcaIdToOutpostId.set(orcaUser.id, existing.id);
                report.users.skipped++;
                continue;
            }

            // Try to link user to account via domain
            let accountId: string | undefined;
            if (transformed.domain) {
                for (const [orcaAcctId, outpostAcctId] of accountMap.entries()) {
                    const orcaAcct = data.accounts.find(a => a.id === orcaAcctId);
                    if (orcaAcct?.domain === transformed.domain) {
                        accountId = outpostAcctId;
                        break;
                    }
                }
            }

            const created = await prisma.user.create({
                data: {
                    ...transformed,
                    ...(accountId ? { accountId } : {}),
                },
            });
            orcaIdToOutpostId.set(orcaUser.id, created.id);
            report.users.created++;
        } catch (err) {
            report.users.failed++;
            report.users.errors.push({
                id: orcaUser.id,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return orcaIdToOutpostId;
}

async function migrateTickets(
    prisma: PrismaClient,
    data: OrcaExport,
    report: MigrationReport,
    dryRun: boolean,
    accountMap: Map<string, string>,
    userMap: Map<string, string>,
    startingCounter: number,
): Promise<void> {
    const total = data.tickets.length;
    let counter = startingCounter;

    for (let i = 0; i < total; i++) {
        const orcaTicket = data.tickets[i];
        logProgress('tickets', i + 1, total);

        try {
            const displayId = formatDisplayId(counter);
            const transformed = transformTicket(orcaTicket, displayId);

            if (dryRun) {
                report.tickets.created++;
                report.messages.total += (orcaTicket.messages ?? []).length;
                counter++;
                continue;
            }

            // Check for existing ticket by sourceId to avoid duplicates
            const existing = await prisma.ticket.findFirst({
                where: { source: 'ORCA', sourceId: orcaTicket.id },
            });

            if (existing) {
                report.tickets.skipped++;
                continue;
            }

            // Resolve foreign keys
            const accountId = orcaTicket.account_id
                ? accountMap.get(orcaTicket.account_id) ?? undefined
                : undefined;
            const userId = orcaTicket.user_id
                ? userMap.get(orcaTicket.user_id) ?? undefined
                : undefined;

            const ticket = await prisma.ticket.create({
                data: {
                    displayId: transformed.displayId,
                    title: transformed.title,
                    description: transformed.description,
                    status: transformed.status as never,
                    priority: transformed.priority as never,
                    type: transformed.type as never,
                    source: 'ORCA',
                    sourceId: transformed.sourceId,
                    sourceUrl: transformed.sourceUrl,
                    createdAt: transformed.createdAt,
                    updatedAt: transformed.updatedAt,
                    ...(accountId ? { accountId } : {}),
                    ...(userId ? { userId } : {}),
                },
            });

            // Migrate messages for this ticket
            const messages = orcaTicket.messages ?? [];
            for (const orcaMsg of messages) {
                const msg = transformMessage(orcaMsg);
                await prisma.message.create({
                    data: {
                        ticketId: ticket.id,
                        author: msg.author,
                        content: msg.content,
                        type: msg.type as never,
                        isAiGenerated: msg.isAiGenerated,
                        attachments: msg.attachments ?? undefined,
                        createdAt: msg.createdAt,
                    },
                });
                report.messages.total++;
            }

            report.tickets.created++;
            counter++;
        } catch (err) {
            report.tickets.failed++;
            report.tickets.errors.push({
                id: orcaTicket.id,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
}

// ─── Rollback ───────────────────────────────────────────────────────────────

async function rollback(prisma: PrismaClient, confirm: boolean): Promise<void> {
    if (!confirm) {
        console.error('\n  Rollback requires --confirm flag to execute.');
        console.error('  Usage: npx tsx scripts/migrate-from-orca.ts --rollback --confirm\n');
        process.exit(1);
    }

    console.log('\n  Rolling back ORCA migration data...');

    // Delete messages on ORCA tickets first (cascade would handle this, but be explicit)
    const orcaTickets = await prisma.ticket.findMany({
        where: { source: 'ORCA' },
        select: { id: true },
    });
    const ticketIds = orcaTickets.map(t => t.id);

    const messagesDeleted = await prisma.message.deleteMany({
        where: { ticketId: { in: ticketIds } },
    });
    console.log(`  Deleted ${messagesDeleted.count} messages`);

    const ticketsDeleted = await prisma.ticket.deleteMany({
        where: { source: 'ORCA' },
    });
    console.log(`  Deleted ${ticketsDeleted.count} tickets`);

    const usersDeleted = await prisma.user.deleteMany({
        where: { source: 'ORCA' },
    });
    console.log(`  Deleted ${usersDeleted.count} users`);

    console.log('\n  Rollback complete.\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const args = parseArgs(process.argv);

    const prisma = new PrismaClient();

    try {
        // Handle rollback mode
        if (args.rollback) {
            await rollback(prisma, args.confirm);
            return;
        }

        // Validate input file argument
        if (!args.input) {
            console.error('\n  Usage: npx tsx scripts/migrate-from-orca.ts --input /path/to/orca-export.json');
            console.error('         npx tsx scripts/migrate-from-orca.ts --input export.json --dry-run');
            console.error('         npx tsx scripts/migrate-from-orca.ts --rollback --confirm\n');
            process.exit(1);
        }

        // Read and parse export file
        const inputPath = resolve(args.input);
        console.log(`\n  Reading export file: ${inputPath}`);

        let rawData: unknown;
        try {
            const content = readFileSync(inputPath, 'utf-8');
            rawData = JSON.parse(content);
        } catch (err) {
            console.error(`  Failed to read/parse input file: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }

        // Validate data structure
        const validation = validateOrcaExport(rawData);
        if (!validation.valid) {
            console.error('\n  Validation errors:');
            for (const err of validation.errors) {
                console.error(`    [${err.entity} ${err.id}] ${err.field}: ${err.message}`);
            }
            process.exit(1);
        }

        const data = rawData as OrcaExport;

        console.log(`  Found: ${data.accounts.length} accounts, ${data.users.length} users, ${data.tickets.length} tickets`);

        if (args.dryRun) {
            console.log('  Mode: DRY RUN (no database writes)');
        }

        // Run migration
        const report = createReport(args.dryRun);

        const startingCounter = args.dryRun ? 1 : await getNextDisplayIdCounter(prisma);

        console.log('');
        const accountMap = await migrateAccounts(prisma, data, report, args.dryRun);
        const userMap = await migrateUsers(prisma, data, report, args.dryRun, accountMap);
        await migrateTickets(prisma, data, report, args.dryRun, accountMap, userMap, startingCounter);

        finalizeReport(report);
        console.log(formatReport(report));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
