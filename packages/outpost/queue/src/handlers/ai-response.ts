/**
 * AI_RESPONSE job handler.
 *
 * The most critical handler in Outpost. Processes AI_RESPONSE jobs by:
 *   1. Loading the ticket and its messages from the database
 *   2. Running the AI pipeline to generate a support response
 *   3. Classifying the ticket inline (priority, type, tags)
 *   4. Formatting the response for the source platform
 *   5. Persisting the AI response as a Message record
 *   6. Enqueuing an ESCALATION job if confidence is too low, if the pipeline
 *      suppressed an ungrounded draft, or if the response never reached the
 *      reporter because platform delivery failed
 *
 * Delivery failure is escalated rather than swallowed because of the guard in
 * step 1b (one response per ticket): once the BOT Message row exists, a retry or
 * a manual re-enqueue is skipped, so an undelivered answer would otherwise leave
 * the reporter permanently silent while the database claims they were answered.
 * A human is the only remaining path, so the handler always pulls one in.
 *
 * The pipeline itself handles Pathfinder retrieval, Claude generation,
 * confidence scoring, platform-specific formatting, and the groundedness gate —
 * so what it hands back is always safe to publish (see SUPPRESSED_RESPONSE_TEXT
 * in packages/outpost/ai/src/pipeline.ts). This handler does not re-check it.
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

    // 1b. ONE RESPONSE PER TICKET — hard invariant, enforced here.
    //
    // Outpost answers exactly one message per ticket: the one that opened it.
    // Every later message in that thread gets no AI reply, no matter who sent
    // it — the original reporter, a third party, or a team member. The agent is
    // a first line of defence and a human owns the thread from the moment the
    // first response lands.
    //
    // The gate lives in the handler rather than at the enqueue sites on
    // purpose. Five separate code paths could enqueue AI_RESPONSE (Discord,
    // Slack, Teams, the GitHub comment webhook, the Postmark reply webhook) and
    // each one previously decided for itself whether a reply warranted an
    // answer. Those enqueues are gone, but a single new caller added later
    // would silently reintroduce the follow-up spam this closes. Checking the
    // ticket's own history catches every re-answer of a ticket we already
    // answered.
    //
    // It is NOT a total gate, so do not lean on it as one. It can only see
    // messages on the ticket, so it cannot tell a first answer from a first
    // answer to the wrong message: a ticket freshly minted around a mid-thread
    // message has no prior AI response and would sail through here. That case
    // (an orphaned reply, no ticket found for the thread) is refused at the
    // enqueue site in InboundHandler.handleReply — see the comment there.
    //
    // Success, not failure: the job did what it should — nothing. Returning an
    // error would put it through the retry ladder for a decision that will
    // never change.
    const priorAiResponse = ticket.messages.find(
        (m: { type: string; isAiGenerated: boolean }) => m.type === 'BOT' && m.isAiGenerated,
    );
    if (priorAiResponse) {
        console.log(
            `[AI Response] Ticket ${ticketId} already answered — skipping. ` +
                `Outpost posts one response per ticket; a human owns this thread now.`,
        );
        return {
            success: true,
            data: { ticketId, skipped: true, reason: 'already_answered' },
        };
    }

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

    // Why the response never reached the reporter, when it didn't. Set by the
    // post-back arm below and consumed by the escalation step: the one-response-
    // per-ticket guard makes an undelivered answer unrecoverable by retry, so a
    // human has to take the thread.
    let deliveryFailure: string | null = null;
    // Set when the ESCALATION enqueue itself failed after a delivery failure —
    // the one case where the job must not report success (see the return below).
    let escalationEnqueueError: string | null = null;

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

        // Store the formatted response on the ticket for bots to pick up.
        //
        // Non-fatal on purpose. The BOT Message row is already committed above,
        // which arms the one-response-per-ticket guard — so if this write threw,
        // the job would abort before post-back and every retry would be skipped
        // by that guard, leaving the reporter permanently unanswered. Log it,
        // remember it, and keep going so delivery still happens.
        let suggestedResponseError: string | null = null;
        try {
            await prisma.ticket.update({
                where: { id: ticket.id },
                data: {
                    suggestedResponse: pipelineResult.formatted.text,
                },
            });
        } catch (error) {
            suggestedResponseError = error instanceof Error ? error.message : String(error);
            console.error(
                `[AI Response] Failed to store suggestedResponse for ticket ${ticketId}:`,
                suggestedResponseError,
            );
        }

        // 5b. Post the response back to the source platform — unconditionally.
        //
        // No suppression check here on purpose. The pipeline withholds an
        // ungrounded draft at the boundary: `pipelineResult.formatted` already
        // carries safe replacement copy whenever `suppressed` is true (see
        // SUPPRESSED_RESPONSE_TEXT in packages/outpost/ai/src/pipeline.ts), so
        // posting it is always correct. Re-gating it here is what previously made
        // shadow mode drop the very records worth studying — the suppressed arm ran
        // before the SHADOW_MODE arm, so nothing was logged. The draft itself is
        // persisted as the BOT Message in step 5 for the human to edit (while
        // suggestedResponse holds the publishable text bots pick up), and step 6
        // below escalates on suppression regardless of score.
        const ticketSource = ticket.source as TicketSource;
        if (pipelineResult.suppressed) {
            console.warn(
                `[AI Response] Ungrounded draft withheld for ticket ${ticketId} — ` +
                    `${pipelineResult.groundedness.reasons.join('; ')}. ` +
                    `Publishing the safe replacement and escalating to a human.`,
            );
        }

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
                const message = error instanceof Error ? error.message : String(error);
                console.error(
                    `[AI Response] Platform adapter misconfigured for ${ticket.source} on ticket ${ticketId}:`,
                    message,
                );
                // Don't attempt postResponse — adapter init failed (permanent error)
                adapter = null;
                deliveryFailure = `platform adapter misconfigured: ${message}`;
            }

            if (adapter) {
                let externalCommentId: string | undefined;
                try {
                    externalCommentId = await adapter.postResponse(
                        {
                            id: ticket.id,
                            sourceId: ticket.sourceId,
                            channel: ticket.channel,
                            source: ticketSource,
                        },
                        pipelineResult.formatted,
                    );
                    console.log(
                        `[AI Response] Posted response to ${ticket.source} for ticket ${ticketId}`,
                    );
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.error(
                        `[AI Response] Failed to post response to ${ticket.source} for ticket ${ticketId}:`,
                        message,
                    );
                    deliveryFailure = message;
                }

                // Recording the external comment ID is bookkeeping for an
                // already-delivered response, so it gets its own try: a failure
                // here must not be mistaken for a delivery failure.
                if (externalCommentId) {
                    try {
                        await prisma.message.update({
                            where: { id: aiMessage.id },
                            data: { externalCommentId },
                        });
                    } catch (error) {
                        console.error(
                            `[AI Response] Failed to record externalCommentId for ticket ${ticketId}:`,
                            error instanceof Error ? error.message : String(error),
                        );
                    }
                }
            }
        } else if (suggestedResponseError) {
            // No adapter for this source, so suggestedResponse WAS the delivery
            // path — and that write failed. Nothing reached the reporter.
            deliveryFailure = `no platform adapter for ${ticket.source} and suggestedResponse could not be stored: ${suggestedResponseError}`;
        }

        await context.reportProgress(85);

        // 6. Enqueue ESCALATION when platform delivery failed, when the response
        // was withheld, or when confidence is below threshold — in the first two
        // cases nothing useful reached the reporter, so a human has to pick it up
        // regardless of what the score says. Delivery failure wins the reason slot
        // because it is the most actionable: the answer exists but is undelivered
        // and, thanks to the one-response-per-ticket guard, undeliverable by retry.
        const escalationReason = deliveryFailure
            ? `AI response generated but not delivered to ${ticket.source} (${deliveryFailure}) — needs a human to answer the reporter`
            : pipelineResult.suppressed
              ? `AI response withheld (${pipelineResult.groundedness.reasons.join('; ')}) — needs a human answer`
              : pipelineResult.confidenceScore < AI_CONFIDENCE.ESCALATE
                ? `Low AI confidence (${(pipelineResult.confidenceScore * 100).toFixed(0)}%) — automated escalation`
                : null;

        if (escalationReason) {
            try {
                await createJob(JobType.ESCALATION, {
                    ticketId: ticket.id,
                    reason: escalationReason,
                });
            } catch (error) {
                escalationEnqueueError = error instanceof Error ? error.message : String(error);
                console.error(
                    `[AI Response] Failed to create escalation job for ticket ${ticketId}:`,
                    escalationEnqueueError,
                );
            }
        }
    } finally {
        pipeline.destroy();
    }

    await context.reportProgress(100);

    console.log(
        `[AI Response] Ticket ${ticketId}: confidence=${pipelineResult.confidenceLevel} ` +
            `(${(pipelineResult.confidenceScore * 100).toFixed(0)}%), latency=${pipelineResult.latencyMs}ms` +
            `${pipelineResult.suppressed ? ', ungrounded draft withheld' : ''}` +
            `${deliveryFailure ? `, delivery failed (${deliveryFailure})` : ''}`,
    );

    const escalated =
        deliveryFailure !== null ||
        pipelineResult.suppressed ||
        pipelineResult.confidenceScore < AI_CONFIDENCE.ESCALATE;

    // An undelivered answer with no escalation behind it is the one outcome that
    // leaves the reporter silent and no human involved, and the guard blocks any
    // retry from repairing it. Report failure so the attempt is recorded as failed
    // and surfaces to an operator rather than being logged and forgotten. Other
    // escalation-enqueue failures keep the historical success result: in those the
    // response did reach the reporter.
    if (deliveryFailure && escalationEnqueueError) {
        return {
            success: false,
            error:
                `Ticket ${ticketId}: AI response not delivered (${deliveryFailure}) and ` +
                `escalation could not be enqueued (${escalationEnqueueError}) — needs manual attention`,
        };
    }

    return {
        success: true,
        data: {
            ticketId,
            confidenceLevel: pipelineResult.confidenceLevel,
            confidenceScore: pipelineResult.confidenceScore,
            latencyMs: pipelineResult.latencyMs,
            escalated,
            suppressed: pipelineResult.suppressed,
            // Not `delivered` — shadow mode deliberately posts nothing, so only
            // the failure is a fact worth reporting.
            deliveryFailed: deliveryFailure !== null,
        },
    };
}
