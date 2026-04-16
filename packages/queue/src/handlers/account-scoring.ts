/**
 * Account scoring job handler.
 *
 * Processes ACCOUNT_SCORING jobs: pulls recent messages for each account,
 * runs sentiment analysis via Claude Haiku, calculates engagement scores,
 * and updates account records in the database.
 *
 * Runs daily via the scheduler, or on-demand for a specific account.
 */

import { prisma } from '@copilotkit/outpost-db';
import { analyzeSentiment, scoreEngagement } from '@copilotkit/outpost-ai';
import type { AccountMetrics } from '@copilotkit/outpost-ai';
import type { AccountScoringPayload, JobResult, JobHandlerContext } from '../types.js';

/** How far back to look for messages when scoring (30 days) */
const SCORING_WINDOW_DAYS = 30;

/** Map from SentimentLabel to the Prisma AccountSentiment enum */
const SENTIMENT_MAP: Record<string, string> = {
    POSITIVE: 'HAPPY',
    NEUTRAL: 'NEUTRAL',
    NEGATIVE: 'AT_RISK',
    CRITICAL: 'CHURNING',
};

/**
 * Handle an ACCOUNT_SCORING job.
 *
 * 1. Load all accounts (or a specific one)
 * 2. For each account: fetch recent messages, run sentiment + engagement analysis
 * 3. Update account records with computed scores
 */
export async function handleAccountScoring(
    payload: AccountScoringPayload,
    context: JobHandlerContext,
): Promise<JobResult> {
    const { accountId } = payload;

    await context.reportProgress(5);

    // Load target accounts
    const accounts = await prisma.account.findMany({
        where: accountId ? { id: accountId } : undefined,
        select: { id: true, name: true },
    });

    if (accounts.length === 0) {
        return {
            success: true,
            data: { message: 'No accounts to score', scored: 0 },
        };
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - SCORING_WINDOW_DAYS);

    let scored = 0;
    const errors: string[] = [];

    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const progress = 5 + Math.round(((i + 1) / accounts.length) * 90);

        try {
            await scoreAccount(account.id, cutoff);
            scored++;
        } catch (error) {
            const msg = `Failed to score account ${account.id} (${account.name}): ${error instanceof Error ? error.message : String(error)}`;
            console.error(`[AccountScoring] ${msg}`);
            errors.push(msg);
        }

        await context.reportProgress(progress);
    }

    await context.reportProgress(100);

    console.log(
        `[AccountScoring] Scored ${scored}/${accounts.length} accounts` +
            (errors.length > 0 ? ` (${errors.length} errors)` : ''),
    );

    return {
        success: errors.length === 0,
        data: {
            total: accounts.length,
            scored,
            errors: errors.length > 0 ? errors : undefined,
        },
        error: errors.length > 0 ? `${errors.length} accounts failed to score` : undefined,
    };
}

/**
 * Score a single account: run sentiment analysis on its messages,
 * compute engagement metrics, and update the database.
 */
async function scoreAccount(accountId: string, cutoff: Date): Promise<void> {
    // Fetch messages from tickets belonging to this account, within the scoring window
    const messages = await prisma.message.findMany({
        where: {
            ticket: { accountId },
            createdAt: { gte: cutoff },
            type: 'USER', // Only analyze customer messages, not bot/system
        },
        select: {
            content: true,
            createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
    });

    // Fetch ticket count for engagement scoring
    const ticketCount = await prisma.ticket.count({
        where: {
            accountId,
            createdAt: { gte: cutoff },
        },
    });

    // Run sentiment analysis on message content
    const messageTexts = messages.map((m: { content: string }) => m.content);
    const sentiment = await analyzeSentiment(messageTexts);

    // Compute engagement metrics
    const now = new Date();
    const windowDays = Math.max(1, (now.getTime() - cutoff.getTime()) / (1000 * 60 * 60 * 24));
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const daysSinceLastActivity = lastMessage
        ? (now.getTime() - lastMessage.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        : windowDays;

    // Simple trend: compare first half to second half ticket counts
    const midpoint = new Date(cutoff.getTime() + (now.getTime() - cutoff.getTime()) / 2);
    const firstHalfCount = await prisma.ticket.count({
        where: {
            accountId,
            createdAt: { gte: cutoff, lt: midpoint },
        },
    });
    const secondHalfCount = ticketCount - firstHalfCount;
    const totalForTrend = firstHalfCount + secondHalfCount;
    const ticketVolumeTrend = totalForTrend > 0
        ? (secondHalfCount - firstHalfCount) / totalForTrend
        : 0;

    const metrics: AccountMetrics = {
        messageCount: messages.length,
        ticketCount,
        avgMessagesPerDay: messages.length / windowDays,
        daysSinceLastActivity,
        responseRate: 50, // Default; would need reply tracking for real calculation
        ticketVolumeTrend,
    };

    const engagement = scoreEngagement(metrics);

    // Map sentiment label to Prisma enum value
    const sentimentValue = SENTIMENT_MAP[sentiment.label] ?? 'NEUTRAL';
    const engagementValue = engagement.level; // Already matches the Prisma enum

    if (sentiment.degraded) {
        // Sentiment analysis failed (Claude call errored) — skip DB write to avoid
        // persisting a fallback score that doesn't reflect real customer sentiment.
        console.warn(
            `[AccountScoring] Account ${accountId}: sentiment analysis degraded, skipping sentiment update. ` +
                `engagement=${engagementValue} (score=${engagement.score})`,
        );
        await prisma.account.update({
            where: { id: accountId },
            data: {
                engagement: engagementValue as 'HIGH' | 'MEDIUM' | 'LOW' | 'INACTIVE',
            },
        });
    } else {
        await prisma.account.update({
            where: { id: accountId },
            data: {
                sentiment: sentimentValue as 'HAPPY' | 'NEUTRAL' | 'AT_RISK' | 'CHURNING',
                engagement: engagementValue as 'HIGH' | 'MEDIUM' | 'LOW' | 'INACTIVE',
            },
        });
        console.log(
            `[AccountScoring] Account ${accountId}: sentiment=${sentimentValue} (score=${sentiment.score}), ` +
                `engagement=${engagementValue} (score=${engagement.score})`,
        );
    }
}
