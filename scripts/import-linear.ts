#!/usr/bin/env npx tsx
// ─── Linear → Outpost Bulk Import Script ──────────────────────────────────
// Imports all issues from a Linear team into Outpost, creating tickets,
// external links, comments, and mapping statuses/priorities/labels.
//
// Usage:
//   npx tsx scripts/import-linear.ts --team-id <LINEAR_TEAM_ID>
//   npx tsx scripts/import-linear.ts --team-id <LINEAR_TEAM_ID> --dry-run
//   npx tsx scripts/import-linear.ts --team-id <LINEAR_TEAM_ID> --since 2024-01-01
//
// Requires LINEAR_API_KEY env var.

import { LinearClient } from '@linear/sdk';
import { PrismaClient } from '@prisma/client';
import {
    createLinearStatusMap,
    createLinearPriorityMap,
    createLinearLabelMapper,
} from '../packages/outpost/shared/src/sync/index.js';

// ─── Types ────────────────────────────────────────────────────────────────

interface CliArgs {
    teamId: string | null;
    dryRun: boolean;
    since: Date | null;
}

interface ImportReport {
    created: number;
    skipped: number;
    matched: number;
    failed: number;
    errors: Array<{ issueId: string; message: string }>;
}

// ─── CLI Argument Parsing ─────────────────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        teamId: null,
        dryRun: false,
        since: null,
    };

    for (let i = 2; i < argv.length; i++) {
        switch (argv[i]) {
            case '--team-id':
                args.teamId = argv[++i] ?? null;
                break;
            case '--dry-run':
                args.dryRun = true;
                break;
            case '--since': {
                const dateStr = argv[++i];
                if (dateStr) {
                    const parsed = new Date(dateStr);
                    if (isNaN(parsed.getTime())) {
                        console.error(`Invalid date: ${dateStr}`);
                        process.exit(1);
                    }
                    args.since = parsed;
                }
                break;
            }
            default:
                console.error(`Unknown argument: ${argv[i]}`);
                process.exit(1);
        }
    }

    return args;
}

// ─── Display ID Generator ─────────────────────────────────────────────────

let displayIdCounter = 0;

async function nextDisplayId(prisma: PrismaClient): Promise<string> {
    if (displayIdCounter === 0) {
        const latest = await (prisma.ticket as { findFirst: (args: Record<string, unknown>) => Promise<{ displayId: string } | null> }).findFirst({
            orderBy: { createdAt: 'desc' },
            select: { displayId: true },
        });
        if (latest) {
            const num = parseInt(latest.displayId.replace('TKT-', ''), 10);
            displayIdCounter = isNaN(num) ? 1000 : num;
        } else {
            displayIdCounter = 1000;
        }
    }
    displayIdCounter++;
    return `TKT-${String(displayIdCounter).padStart(4, '0')}`;
}

// ─── Import Logic ─────────────────────────────────────────────────────────

export async function importLinearIssues(
    linearClient: LinearClient,
    prisma: PrismaClient,
    args: CliArgs,
): Promise<ImportReport> {
    const report: ImportReport = {
        created: 0,
        skipped: 0,
        matched: 0,
        failed: 0,
        errors: [],
    };

    const statusMap = createLinearStatusMap();
    const priorityMap = createLinearPriorityMap();
    const labelMapper = createLinearLabelMapper();

    const teamId = args.teamId!;
    console.log(`Fetching issues for team ${teamId}...`);

    // Paginate through all issues
    let hasMore = true;
    let afterCursor: string | undefined;

    while (hasMore) {
        const issuesPage = await linearClient.issues({
            filter: {
                team: { id: { eq: teamId } },
                ...(args.since ? { createdAt: { gte: args.since } } : {}),
            },
            first: 50,
            after: afterCursor,
        });

        for (const issue of issuesPage.nodes) {
            try {
                // Check if this issue is already linked
                const existingLink = await (prisma.ticketExternalLink as {
                    findUnique: (args: Record<string, unknown>) => Promise<{ id: string; ticketId: string } | null>;
                }).findUnique({
                    where: {
                        plugin_externalId: {
                            plugin: 'linear',
                            externalId: issue.id,
                        },
                    },
                });

                if (existingLink) {
                    report.skipped++;
                    console.log(`  SKIP ${issue.identifier}: already linked to ${existingLink.ticketId}`);
                    continue;
                }

                // Check for cross-reference to GitHub via attachments
                const attachments = await issue.attachments();
                let matchedTicketId: string | null = null;

                for (const attachment of attachments.nodes) {
                    const url = attachment.url;
                    if (url && /github\.com\/.*\/(issues|pull)\/\d+/.test(url)) {
                        // Try to find an existing ticket linked to this GitHub URL
                        const githubLink = await (prisma.ticketExternalLink as {
                            findFirst: (args: Record<string, unknown>) => Promise<{ ticketId: string } | null>;
                        }).findFirst({
                            where: {
                                plugin: 'github',
                                externalUrl: url,
                            },
                        });
                        if (githubLink) {
                            matchedTicketId = githubLink.ticketId;
                            break;
                        }
                    }
                }

                if (matchedTicketId) {
                    // Cross-reference match: link to existing ticket
                    if (!args.dryRun) {
                        await (prisma.ticketExternalLink as {
                            create: (args: Record<string, unknown>) => Promise<unknown>;
                        }).create({
                            data: {
                                ticketId: matchedTicketId,
                                plugin: 'linear',
                                externalId: issue.id,
                                externalUrl: issue.url,
                                metadata: { identifier: issue.identifier },
                            },
                        });
                    }
                    report.matched++;
                    console.log(`  MATCH ${issue.identifier} → existing ticket ${matchedTicketId}`);
                    continue;
                }

                // Resolve status and priority
                const state = await issue.state;
                const outpostStatus = state ? statusMap.toOutpost(state.name) : 'OPEN';
                const outpostPriority = priorityMap.toOutpost(String(issue.priority));

                // Resolve labels
                const issueLabels = await issue.labels();
                const labelNames = issueLabels.nodes.map((l: { name: string }) => l.name);
                const outpostTags = labelMapper.toOutpost(labelNames);

                if (args.dryRun) {
                    console.log(`  DRY-RUN ${issue.identifier}: would create ticket (${outpostStatus}, ${outpostPriority})`);
                    report.created++;
                    continue;
                }

                // Create the Outpost ticket
                const displayId = await nextDisplayId(prisma);
                const ticket = await (prisma.ticket as {
                    create: (args: Record<string, unknown>) => Promise<{ id: string }>;
                }).create({
                    data: {
                        displayId,
                        title: issue.title,
                        description: issue.description ?? '',
                        status: outpostStatus,
                        priority: outpostPriority,
                        type: 'OTHER',
                        source: 'MANUAL', // LINEAR not in TicketSource enum yet
                        additionalInfo: {
                            linearIdentifier: issue.identifier,
                            linearUrl: issue.url,
                            tags: outpostTags,
                        },
                    },
                });

                // Create the external link
                await (prisma.ticketExternalLink as {
                    create: (args: Record<string, unknown>) => Promise<unknown>;
                }).create({
                    data: {
                        ticketId: ticket.id,
                        plugin: 'linear',
                        externalId: issue.id,
                        externalUrl: issue.url,
                        metadata: { identifier: issue.identifier },
                    },
                });

                // Import comments
                const comments = await issue.comments();
                for (const comment of comments.nodes) {
                    const authorUser = await comment.user;
                    await (prisma.message as {
                        create: (args: Record<string, unknown>) => Promise<unknown>;
                    }).create({
                        data: {
                            ticketId: ticket.id,
                            author: authorUser?.name ?? 'Unknown',
                            content: comment.body,
                            type: 'USER',
                        },
                    });
                }

                report.created++;
                console.log(`  CREATE ${issue.identifier} → ${displayId} (${comments.nodes.length} comments)`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                report.failed++;
                report.errors.push({
                    issueId: issue.id,
                    message,
                });
                console.error(`  FAIL ${issue.identifier ?? issue.id}: ${message}`);
            }
        }

        hasMore = issuesPage.pageInfo.hasNextPage;
        afterCursor = issuesPage.pageInfo.endCursor;
    }

    return report;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const args = parseArgs(process.argv);

    if (!args.teamId) {
        console.error('Usage: npx tsx scripts/import-linear.ts --team-id <TEAM_ID> [--dry-run] [--since DATE]');
        process.exit(1);
    }

    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
        console.error('LINEAR_API_KEY environment variable is required');
        process.exit(1);
    }

    const linearClient = new LinearClient({ apiKey });
    const prisma = new PrismaClient();

    try {
        console.log(`\nLinear Import — team ${args.teamId}`);
        if (args.dryRun) {
            console.log('  (DRY RUN — no database writes)\n');
        }
        if (args.since) {
            console.log(`  Filtering issues since ${args.since.toISOString()}\n`);
        }

        const report = await importLinearIssues(linearClient, prisma, args);

        console.log('\n─── Import Summary ───');
        console.log(`  Created:  ${report.created}`);
        console.log(`  Skipped:  ${report.skipped}`);
        console.log(`  Matched:  ${report.matched}`);
        console.log(`  Failed:   ${report.failed}`);

        if (report.errors.length > 0) {
            console.log('\n─── Errors ───');
            for (const err of report.errors) {
                console.log(`  ${err.issueId}: ${err.message}`);
            }
        }

        console.log('\nDone.');
    } finally {
        await prisma.$disconnect();
    }
}

// Only run when executed directly (not when imported by tests)
const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''));
if (isDirectRun) {
    main().catch((err) => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}
