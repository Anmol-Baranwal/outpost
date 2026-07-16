/**
 * AI_RESPONSE job handler.
 *
 * The most critical handler in Outpost. Processes AI_RESPONSE jobs by:
 *   1. Loading the ticket and its messages from the database
 *   2. Running the AI pipeline to generate a support response
 *   3. Classifying the ticket inline (priority, type, tags)
 *   4. Formatting the response for the source platform
 *   5. Persisting the AI response as a Message record
 *   6. Enqueuing an ESCALATION job if confidence is too low
 *
 * The pipeline itself handles Pathfinder retrieval, Claude generation,
 * confidence scoring, and platform-specific formatting.
 */

import { prisma } from '@copilotkit/outpost/db';
import { AIPipeline } from '@copilotkit/outpost/ai';
import { AI_CONFIDENCE } from '@copilotkit/outpost/shared';
import type { PlatformTarget, TicketSource } from '@copilotkit/outpost/shared';
import { hasAdapter, getAdapter } from '@copilotkit/outpost/shared/platforms';
import { createJob } from '../create-job.js';
import { getFeedbackCalibration } from '../feedback-calibration.js';
import { JobType } from '../types.js';
import type { AiResponsePayload, JobResult, JobHandlerContext } from '../types.js';

/**
 * Map from TicketSource enum values (stored in DB) to PlatformTarget
 * strings used by the AI formatter. TicketSource uses uppercase enums
 * (e.g. 'DISCORD') while PlatformTarget uses lowercase literals
 * (e.g. 'discord').
 */
function toPlatformTarget(source: string): PlatformTarget {
    const mapping: Record<string, PlatformTarget> = {
        DISCORD: 'discord',
        GITHUB_ISSUE: 'github',
        GITHUB_DISCUSSION: 'github',
        SLACK: 'slack',
        TEAMS: 'teams',
        WEB: 'web',
        EMAIL: 'web',
        LINEAR: 'web',
        MANUAL: 'web',
        ORCA: 'web',
    };
    return mapping[source] ?? 'web';
}

export async function handleAiResponse(
    payload: AiResponsePayload,
    context: JobHandlerContext,
): Promise<JobResult> {
    const { ticketId } = payload;

    await context.reportProgress(10);

    // 1. Load ticket with account, user, and messages
    const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: {
            account: true,
            user: true,
            messages: { orderBy: { createdAt: 'asc' } },
        },
    });

    if (!ticket) {
        return {
            success: false,
            error: `Ticket ${ticketId} not found`,
        };
    }

    await context.reportProgress(20);

    // 2. Build conversation history from DB messages
    const conversationHistory = ticket.messages
        .filter((m: { type: string }) => m.type !== 'SYSTEM')
        .map((m: { type: string; content: string }) => ({
            role: (m.type === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.content,
        }));

    // Determine the latest user message as the question
    const latestUserMessage = [...ticket.messages]
        .reverse()
        .find((m: { type: string }) => m.type === 'USER');
    const question = latestUserMessage?.content ?? ticket.description ?? ticket.title;

    // Determine platform target for formatting
    const platform = payload.source ?? toPlatformTarget(ticket.source);

    // 3. Run AI pipeline to generate response
    let pipeline: AIPipeline;
    try {
        pipeline = new AIPipeline();
    } catch (error) {
        return {
            success: false,
            error: `AI pipeline initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }

    // Read the aggregate feedback calibration; never fail generation because
    // the tally couldn't be read (single fail-soft site).
    let confidenceCalibration = 0;
    try {
        confidenceCalibration = await getFeedbackCalibration(prisma);
    } catch (error) {
        console.error(
            `[AI Response] Failed to read feedback calibration, defaulting to 0: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    console.log(`[AI Response] Confidence calibration: ${confidenceCalibration.toFixed(4)}`);

    let pipelineResult;
    try {
        try {
            pipelineResult = await pipeline.generateSupportResponse(question, {
                source: platform,
                conversationHistory,
                confidenceCalibration,
            });
        } catch (error) {
            return {
                success: false,
                error: `AI pipeline generation failed: ${error instanceof Error ? error.message : String(error)}`,
            };
        }

        await context.reportProgress(50);

        // 4. Classify ticket inline
        try {
            const classification = await pipeline.classifyTicket(
                ticket.title + '\n' + ticket.description,
            );

            await prisma.ticket.update({
                where: { id: ticket.id },
                data: {
                    priority: classification.priority,
                    type: classification.type,
                },
            });
        } catch (error) {
            // Classification failure is non-fatal; log and continue
            console.error(
                `[AI Response] Classification failed for ticket ${ticketId}:`,
                error instanceof Error ? error.message : String(error),
            );
        }

        await context.reportProgress(70);

        // 5. Persist the AI-generated response as a Message record
        const aiMessage = await prisma.message.create({
            data: {
                ticketId: ticket.id,
                content: pipelineResult.response,
                type: 'BOT',
                author: 'Outpost AI',
                isAiGenerated: true,
                confidenceScore: pipelineResult.confidenceScore,
                confidenceLevel: pipelineResult.confidenceLevel,
            },
        });

        // Store the formatted response on the ticket for bots to pick up
        await prisma.ticket.update({
            where: { id: ticket.id },
            data: {
                suggestedResponse: pipelineResult.formatted.text,
            },
        });

        // 5b. Post the response back to the source platform
        const ticketSource = ticket.source as TicketSource;
        if (process.env.SHADOW_MODE === 'true') {
            try {
                await prisma.message.create({
                    data: {
                        ticketId: ticket.id,
                        author: 'outpost-shadow',
                        content: pipelineResult.formatted.text,
                        type: 'SYSTEM',
                        isAiGenerated: true,
                        attachments: {
                            shadowMode: true,
                            latencyMs: pipelineResult.latencyMs,
                            generatedAt: new Date().toISOString(),
                        },
                    },
                });
                console.log(
                    `[AI Response] Shadow mode — logged response for ticket ${ticketId}, skipping platform post-back`,
                );
            } catch (error) {
                console.error(
                    `[AI Response] Shadow mode — failed to log response for ticket ${ticketId}:`,
                    error instanceof Error ? error.message : String(error),
                );
            }
        } else if (hasAdapter(ticketSource)) {
            let adapter;
            try {
                adapter = getAdapter(ticketSource);
            } catch (error) {
                console.error(
                    `[AI Response] Platform adapter misconfigured for ${ticket.source} on ticket ${ticketId}:`,
                    error instanceof Error ? error.message : String(error),
                );
                // Don't attempt postResponse — adapter init failed (permanent error)
                adapter = null;
            }

            if (adapter) {
                try {
                    const externalCommentId = await adapter.postResponse(
                        {
                            id: ticket.id,
                            sourceId: ticket.sourceId,
                            channel: ticket.channel,
                            source: ticketSource,
                        },
                        pipelineResult.formatted,
                    );
                    if (externalCommentId) {
                        await prisma.message.update({
                            where: { id: aiMessage.id },
                            data: { externalCommentId },
                        });
                    }
                    console.log(
                        `[AI Response] Posted response to ${ticket.source} for ticket ${ticketId}`,
                    );
                } catch (error) {
                    console.error(
                        `[AI Response] Failed to post response to ${ticket.source} for ticket ${ticketId}:`,
                        error instanceof Error ? error.message : String(error),
                    );
                }
            }
        }

        await context.reportProgress(85);

        // 6. If confidence is below the escalation threshold, enqueue ESCALATION
        if (pipelineResult.confidenceScore < AI_CONFIDENCE.ESCALATE) {
            try {
                await createJob(JobType.ESCALATION, {
                    ticketId: ticket.id,
                    reason: `Low AI confidence (${(pipelineResult.confidenceScore * 100).toFixed(0)}%) — automated escalation`,
                });
            } catch (error) {
                console.error(
                    `[AI Response] Failed to create escalation job for ticket ${ticketId}:`,
                    error instanceof Error ? error.message : String(error),
                );
            }
        }
    } finally {
        pipeline.destroy();
    }

    await context.reportProgress(100);

    console.log(
        `[AI Response] Ticket ${ticketId}: confidence=${pipelineResult.confidenceLevel} ` +
            `(${(pipelineResult.confidenceScore * 100).toFixed(0)}%), latency=${pipelineResult.latencyMs}ms`,
    );

    return {
        success: true,
        data: {
            ticketId,
            confidenceLevel: pipelineResult.confidenceLevel,
            confidenceScore: pipelineResult.confidenceScore,
            latencyMs: pipelineResult.latencyMs,
            escalated: pipelineResult.confidenceScore < AI_CONFIDENCE.ESCALATE,
        },
    };
}
