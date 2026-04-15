#!/usr/bin/env npx tsx
// ─── Shadow Mode Quality Validation ─────────────────────────────────────────
// Compares Outpost's shadow responses against Orca's actual posted responses.
//
// Usage:
//   npx tsx scripts/cutover/validate-quality.ts
//   npx tsx scripts/cutover/validate-quality.ts --since 2024-01-01
//   npx tsx scripts/cutover/validate-quality.ts --min-sample 50

import { PrismaClient } from '@prisma/client';

// ─── Types ──────────────────────────────────────────────────────────────────

interface QualityMetrics {
    totalTickets: number;
    ticketsWithShadowResponses: number;
    ticketsWithOrcaResponses: number;
    ticketsWithBoth: number;
    averageShadowResponseTimeMs: number;
    averageOrcaResponseTimeMs: number;
    contentQuality: {
        averageShadowLength: number;
        averageOrcaLength: number;
        shadowCodeBlockCount: number;
        orcaCodeBlockCount: number;
        shadowLinkCount: number;
        orcaLinkCount: number;
    };
    confidenceDistribution: {
        high: number;
        medium: number;
        low: number;
    };
    recommendation: 'READY' | 'NOT_READY' | 'NEEDS_MORE_DATA';
    reasons: string[];
}

interface CliArgs {
    since: Date | null;
    minSample: number;
}

// ─── CLI Parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        since: null,
        minSample: 20,
    };

    for (let i = 2; i < argv.length; i++) {
        switch (argv[i]) {
            case '--since':
                args.since = new Date(argv[++i] ?? '');
                break;
            case '--min-sample':
                args.minSample = parseInt(argv[++i] ?? '20', 10);
                break;
        }
    }

    return args;
}

// ─── Content Analysis ───────────────────────────────────────────────────────

function countCodeBlocks(content: string): number {
    const matches = content.match(/```[\s\S]*?```/g);
    return matches?.length ?? 0;
}

function countLinks(content: string): number {
    const matches = content.match(/https?:\/\/[^\s)>\]]+/g);
    return matches?.length ?? 0;
}

function classifyConfidence(content: string): 'high' | 'medium' | 'low' {
    const lowConfidenceSignals = [
        /i'm not sure/i,
        /i don't know/i,
        /i cannot/i,
        /unfortunately/i,
        /i don't have enough/i,
    ];

    const highConfidenceSignals = [
        /```/,             // Code blocks suggest concrete answers
        /https?:\/\//,     // Links suggest specific references
        /step \d/i,        // Step-by-step instructions
        /here's how/i,
    ];

    const lowScore = lowConfidenceSignals.filter(r => r.test(content)).length;
    const highScore = highConfidenceSignals.filter(r => r.test(content)).length;

    if (highScore >= 2 && lowScore === 0) return 'high';
    if (lowScore >= 2) return 'low';
    return 'medium';
}

// ─── Validation Logic ───────────────────────────────────────────────────────

export async function validateQuality(
    prisma: PrismaClient,
    args: CliArgs,
): Promise<QualityMetrics> {
    const whereClause = args.since
        ? { createdAt: { gte: args.since } }
        : {};

    // Fetch all shadow responses (NOTE messages from outpost-shadow)
    const shadowMessages = await prisma.message.findMany({
        where: {
            author: 'outpost-shadow',
            type: 'NOTE',
            isAiGenerated: true,
            ...whereClause,
        },
        include: {
            ticket: true,
        },
    });

    // Fetch Orca AI responses (AI messages from the orca bot)
    // Orca responses are identified by source=ORCA on the ticket
    const orcaTickets = await prisma.ticket.findMany({
        where: {
            source: 'ORCA',
            ...whereClause,
        },
        include: {
            messages: {
                where: { isAiGenerated: true },
            },
        },
    });

    // Also fetch Discord-source tickets that have shadow responses
    const shadowTicketIds = [...new Set(shadowMessages.map(m => m.ticketId))];
    const discordTickets = await prisma.ticket.findMany({
        where: {
            source: 'DISCORD',
            id: { in: shadowTicketIds },
        },
        include: {
            messages: {
                where: { isAiGenerated: true },
            },
        },
    });

    // Build metrics
    const allTicketIds = new Set([
        ...shadowTicketIds,
        ...orcaTickets.map(t => t.id),
    ]);

    const shadowResponseTimes: number[] = [];
    const orcaResponseTimes: number[] = [];
    const shadowLengths: number[] = [];
    const orcaLengths: number[] = [];
    let shadowCodeBlocks = 0;
    let orcaCodeBlocks = 0;
    let shadowLinks = 0;
    let orcaLinks = 0;
    const confidenceDist = { high: 0, medium: 0, low: 0 };

    for (const msg of shadowMessages) {
        shadowLengths.push(msg.content.length);
        shadowCodeBlocks += countCodeBlocks(msg.content);
        shadowLinks += countLinks(msg.content);
        confidenceDist[classifyConfidence(msg.content)]++;

        // Extract response time from attachments metadata
        const attachments = msg.attachments as Record<string, unknown> | null;
        if (attachments?.responseTimeMs) {
            shadowResponseTimes.push(Number(attachments.responseTimeMs));
        }
    }

    for (const ticket of orcaTickets) {
        for (const msg of ticket.messages) {
            orcaLengths.push(msg.content.length);
            orcaCodeBlocks += countCodeBlocks(msg.content);
            orcaLinks += countLinks(msg.content);
        }
    }

    const avg = (arr: number[]) => arr.length > 0
        ? arr.reduce((a, b) => a + b, 0) / arr.length
        : 0;

    const ticketsWithBoth = discordTickets.filter(t =>
        shadowMessages.some(m => m.ticketId === t.id),
    ).length;

    // Determine recommendation
    const reasons: string[] = [];
    let recommendation: QualityMetrics['recommendation'] = 'READY';

    if (shadowMessages.length < args.minSample) {
        recommendation = 'NEEDS_MORE_DATA';
        reasons.push(
            `Only ${shadowMessages.length} shadow responses collected ` +
            `(minimum: ${args.minSample})`,
        );
    }

    const avgResponseTime = avg(shadowResponseTimes);
    if (avgResponseTime > 600000) { // 10 minutes in ms
        recommendation = 'NOT_READY';
        reasons.push(
            `Average response time ${Math.round(avgResponseTime / 1000)}s exceeds 10 minute target`,
        );
    }

    const avgShadowLen = avg(shadowLengths);
    const avgOrcaLen = avg(orcaLengths);
    if (avgOrcaLen > 0 && avgShadowLen < avgOrcaLen * 0.5) {
        recommendation = 'NOT_READY';
        reasons.push(
            `Shadow responses are significantly shorter than Orca ` +
            `(${Math.round(avgShadowLen)} vs ${Math.round(avgOrcaLen)} chars)`,
        );
    }

    const lowConfidenceRate = shadowMessages.length > 0
        ? confidenceDist.low / shadowMessages.length
        : 0;
    if (lowConfidenceRate > 0.2) {
        if (recommendation !== 'NOT_READY') recommendation = 'NOT_READY';
        reasons.push(
            `${Math.round(lowConfidenceRate * 100)}% of responses have low confidence ` +
            `(target: <20%)`,
        );
    }

    if (reasons.length === 0) {
        reasons.push('All quality metrics meet targets');
    }

    return {
        totalTickets: allTicketIds.size,
        ticketsWithShadowResponses: shadowTicketIds.length,
        ticketsWithOrcaResponses: orcaTickets.length,
        ticketsWithBoth,
        averageShadowResponseTimeMs: avgResponseTime,
        averageOrcaResponseTimeMs: avg(orcaResponseTimes),
        contentQuality: {
            averageShadowLength: avgShadowLen,
            averageOrcaLength: avgOrcaLen,
            shadowCodeBlockCount: shadowCodeBlocks,
            orcaCodeBlockCount: orcaCodeBlocks,
            shadowLinkCount: shadowLinks,
            orcaLinkCount: orcaLinks,
        },
        confidenceDistribution: confidenceDist,
        recommendation,
        reasons,
    };
}

// ─── Report Formatting ──────────────────────────────────────────────────────

function formatReport(metrics: QualityMetrics): string {
    const lines: string[] = [
        '',
        '═══ Outpost Shadow Mode Quality Report ═══',
        '',
        `  Tickets analyzed:          ${metrics.totalTickets}`,
        `  With shadow responses:     ${metrics.ticketsWithShadowResponses}`,
        `  With Orca responses:       ${metrics.ticketsWithOrcaResponses}`,
        `  With both (comparable):    ${metrics.ticketsWithBoth}`,
        '',
        '─── Response Time ───',
        `  Outpost average:           ${Math.round(metrics.averageShadowResponseTimeMs / 1000)}s`,
        `  Orca average:              ${Math.round(metrics.averageOrcaResponseTimeMs / 1000)}s`,
        '',
        '─── Content Quality ───',
        `  Outpost avg length:        ${Math.round(metrics.contentQuality.averageShadowLength)} chars`,
        `  Orca avg length:           ${Math.round(metrics.contentQuality.averageOrcaLength)} chars`,
        `  Outpost code blocks:       ${metrics.contentQuality.shadowCodeBlockCount}`,
        `  Orca code blocks:          ${metrics.contentQuality.orcaCodeBlockCount}`,
        `  Outpost links:             ${metrics.contentQuality.shadowLinkCount}`,
        `  Orca links:                ${metrics.contentQuality.orcaLinkCount}`,
        '',
        '─── Confidence Distribution ───',
        `  High:                      ${metrics.confidenceDistribution.high}`,
        `  Medium:                    ${metrics.confidenceDistribution.medium}`,
        `  Low:                       ${metrics.confidenceDistribution.low}`,
        '',
        '─── Recommendation ───',
        `  Status: ${metrics.recommendation}`,
    ];

    for (const reason of metrics.reasons) {
        lines.push(`    - ${reason}`);
    }

    lines.push('');
    return lines.join('\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const args = parseArgs(process.argv);
    const prisma = new PrismaClient();

    try {
        console.log('\n  Analyzing shadow mode quality...');
        const metrics = await validateQuality(prisma, args);
        console.log(formatReport(metrics));

        // Exit with non-zero if not ready
        if (metrics.recommendation === 'NOT_READY') {
            process.exit(1);
        }
    } finally {
        await prisma.$disconnect();
    }
}

// Only run when executed directly (not when imported for testing)
const isDirectExecution = process.argv[1]?.endsWith('validate-quality.ts') ?? false;
if (isDirectExecution) {
    main().catch((err) => {
        console.error('Quality validation failed:', err);
        process.exit(1);
    });
}
