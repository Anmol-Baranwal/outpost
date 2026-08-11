/**
 * AI_RESPONSE job handler.
 *
 * The most critical handler in Outpost. Processes AI_RESPONSE jobs by:
 *   1.  Loading the ticket and its messages from the database
 *   1b. Finishing immediately, as a success, if the ticket already holds an AI
 *       response — one response per ticket (see the gate below)
 *   2.  Running the AI pipeline to generate a support response
 *   3.  Classifying the ticket inline (priority, type, tags)
 *   4.  Formatting the response for the source platform
 *   5.  Persisting the AI response as a Message record, and the formatted text
 *       on the ticket as suggestedResponse
 *   5b. Posting the response back to the source platform through its adapter —
 *       except under SHADOW_MODE=true, where the response is instead logged as a
 *       SYSTEM message on the ticket and nothing is posted anywhere
 *   6.  Enqueuing an ESCALATION job if confidence is too low, if the pipeline
 *       suppressed an ungrounded draft, or if the response never reached the
 *       reporter because platform delivery failed
 *
 * The BOT Message starts in PENDING before any external post. Successful
 * delivery marks it DELIVERED; a durable escalation marks it ESCALATED. If an
 * attempt ends while it is still PENDING, a retry preserves the one-post rule
 * and pulls in a human instead of posting the response a second time.
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

const PRIMARY_AI_RESPONSE_KEY = 'PRIMARY_AI_RESPONSE';
const RESPONSE_RECOVERY_AFTER_MS = 5 * 60 * 1000;

interface StoredAiResponse {
    id: string;
    type: string;
    isAiGenerated: boolean;
    responseKey?: string | null;
    responseState?: string | null;
    responseJobId?: string | null;
    responseError?: string | null;
    createdAt?: Date;
}

/**
 * Identify the unique-key collision raised when another handler wins the
 * per-ticket primary-response slot. Keep this narrow: an unrelated P2002 must
 * still fail the job rather than being mislabeled as a harmless duplicate.
 */
function isPrimaryAiResponseConflict(error: unknown): boolean {
    if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        (error as { code?: unknown }).code !== 'P2002'
    ) {
        return false;
    }

    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    if (Array.isArray(target)) {
        return target.includes('ticketId') && target.includes('responseKey');
    }

    return (
        typeof target === 'string' &&
        (target === 'Message_ticketId_responseKey_key' ||
            (target.includes('ticketId') && target.includes('responseKey')))
    );
}

/**
 * A PENDING response owned by this job means an earlier attempt ended after
 * winning the one-response slot. A sufficiently old response may also be
 * recovered by a replacement/manual job. Fresh rows owned by another job are
 * left alone because that job may still be posting.
 */
function shouldRecoverPendingResponse(
    response: StoredAiResponse,
    currentJobId: string,
): boolean {
    if (
        response.responseKey !== PRIMARY_AI_RESPONSE_KEY ||
        response.responseState !== 'PENDING'
    ) {
        return false;
    }

    if (response.responseJobId === currentJobId) return true;
    if (!response.createdAt) return false;
    return Date.now() - response.createdAt.getTime() >= RESPONSE_RECOVERY_AFTER_MS;
}

async function recoverPendingResponse(
    ticketId: string,
    ticketSource: string,
    response: StoredAiResponse,
    context: JobHandlerContext,
): Promise<JobResult> {
    const deliveryDetail = response.responseError
        ? `Last delivery error: ${response.responseError}.`
        : 'The previous attempt ended before delivery became durable.';
    const reason =
        `AI response for ${ticketSource} is pending after an interrupted attempt. ` +
        `${deliveryDetail} A human must verify the thread and answer if needed.`;

    try {
        await createJob(JobType.ESCALATION, { ticketId, reason });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: `Ticket ${ticketId}: pending AI response recovery could not enqueue escalation (${message})`,
        };
    }

    // The escalation job is already durable. If this bookkeeping write fails,
    // do not fail and enqueue duplicate escalations on another retry.
    try {
        await prisma.message.update({
            where: { id: response.id },
            data: { responseState: 'ESCALATED' },
        });
    } catch (error) {
        console.error(
            `[AI Response] Escalation was enqueued but response state could not be recorded for ticket ${ticketId}:`,
            error instanceof Error ? error.message : String(error),
        );
    }

    await context.reportProgress(100);
    return {
        success: true,
        data: {
            ticketId,
            skipped: true,
            escalated: true,
            deliveryFailed: true,
            reason: 'delivery_recovered',
        },
    };
}

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

    // 1b. ONE RESPONSE PER TICKET — RE-ANSWER guard.
    //
    // Outpost answers exactly one message per ticket: the one that opened it.
    // Every later message in that thread gets no AI reply, no matter who sent
    // it — the original reporter, a third party, or a team member. The agent is
    // a first line of defence and a human owns the thread from the moment the
    // first response lands.
    //
    // What this gate does and does not do, because the distinction matters:
    //
    // The invariant is enforced at the enqueue sites, not here. Three of them
    // exist — InboundHandler.handleNewTicket (Discord, Slack and Teams all
    // funnel through it), handleShadowThreadCreate in the Discord bot's
    // shadow-mode path, and the Postmark webhook's new-email branch — and every
    // one enqueues only for a message that opens a ticket. Their refusal to
    // enqueue for anything else is what holds the rule.
    //
    // This gate catches the second answer to a ticket that already has one: a
    // retried job, a manual re-enqueue, or a caller added later that does not
    // respect the rule. It CANNOT stand in for those refusals, so do not lean
    // on it as if it could. It only sees messages on the ticket, so it cannot
    // tell a first answer from a first answer to the wrong message: a ticket
    // freshly minted around a mid-thread reply carries no prior AI response and
    // sails straight through here. That case (an orphaned reply, no ticket found
    // for the thread) is refused where the ticket is created — see
    // InboundHandler.handleReply.
    //
    // Success, not failure: the job did what it should — nothing. Returning an
    // error would put it through the retry ladder for a decision that will
    // never change.
    const priorAiResponse = ticket.messages.find(
        (m: StoredAiResponse) => m.type === 'BOT' && m.isAiGenerated,
    ) as StoredAiResponse | undefined;
    if (priorAiResponse) {
        if (shouldRecoverPendingResponse(priorAiResponse, context.jobId)) {
            return recoverPendingResponse(ticketId, ticket.source, priorAiResponse, context);
        }

        console.log(
            `[AI Response] Ticket ${ticketId} already answered — skipping. ` +
                `Outpost posts one response per ticket; a human owns this thread now.`,
        );
        // Walk the ladder to 100 like every other successful exit. This job
        // succeeded — it decided to do nothing — so anything reading job
        // progress (dashboard, ops query) must see it finished, not parked at
        // 20% looking hung. Failure exits deliberately leave progress where it
        // stopped: the job row records status FAILED next to it, so a partial
        // number is the honest reading there.
        await context.reportProgress(100);
        return {
            success: true,
            data: { ticketId, skipped: true, reason: 'already_answered' },
        };
    }

    // 2. Build conversation history from DB messages.
    //
    // Deliberately the FULL non-SYSTEM history, including any message that
    // arrived after the one being answered. See the question selection below for
    // why the two are allowed to disagree.
    const conversationHistory = ticket.messages
        .filter((m: { type: string }) => m.type !== 'SYSTEM')
        .map((m: { type: string; content: string }) => ({
            role: (m.type === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.content,
        }));

    // The question is the message that OPENED the ticket — the same message the
    // one-response-per-ticket invariant above says we get to answer.
    //
    // `ticket.messages` is loaded `orderBy: { createdAt: 'asc' }`, so the FIRST
    // USER row is the opening message. Scanning from the other end and taking
    // the LATEST USER row was wrong: replies are still persisted as USER
    // messages (correctly — they belong in the thread's history), so a reporter
    // who splits a thought across two Discord messages in the seconds between
    // ticket creation and this job running had the ticket's one and only answer
    // aimed at the follow-up fragment instead of the question that opened it.
    // One shot, spent on the wrong sentence.
    //
    // The interim follow-up deliberately STAYS in `conversationHistory`. Those
    // two inputs answer different questions: `question` is what to respond to,
    // `conversationHistory` is what the responder knows. A follow-up is usually
    // the same thought continued — a stack trace, a version number, "on Next 15"
    // — and it is exactly the detail that makes the single answer good, so
    // dropping it would trade one bug for a worse answer. Suppressing it would
    // also need a second policy for the non-USER rows after the opening, with no
    // evidence behind it.
    const openingUserMessage = ticket.messages.find((m: { type: string }) => m.type === 'USER');
    const question = openingUserMessage?.content ?? ticket.description ?? ticket.title;

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
    // post-back arm below and consumed by the escalation step. If this attempt
    // cannot durably enqueue that escalation, the PENDING response lets its
    // retry finish the handoff without risking a second external post.
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

        // 5. Persist the AI-generated response and atomically claim this
        // ticket's one primary-response slot. The history check above avoids
        // unnecessary model work in the common case, but it cannot serialize
        // overlapping jobs: both can read the same no-response snapshot. The
        // database unique key on (ticketId, responseKey) elects exactly one
        // winner before either invocation reaches platform post-back.
        let aiMessage;
        try {
            const aiMessageData = {
                ticketId: ticket.id,
                content: pipelineResult.response,
                type: 'BOT' as const,
                author: 'Outpost AI',
                isAiGenerated: true,
                confidenceScore: pipelineResult.confidenceScore,
                confidenceLevel: pipelineResult.confidenceLevel,
                responseKey: PRIMARY_AI_RESPONSE_KEY,
                responseState: 'PENDING',
                responseJobId: context.jobId,
                responseError: null,
            };
            aiMessage = await prisma.message.create({
                data: aiMessageData,
            });
        } catch (error) {
            if (!isPrimaryAiResponseConflict(error)) throw error;

            console.log(
                `[AI Response] Ticket ${ticketId} was answered by a concurrent job — skipping platform post-back.`,
            );
            await context.reportProgress(100);
            return {
                success: true,
                data: { ticketId, skipped: true, reason: 'already_answered' },
            };
        }

        // Store the formatted response on the ticket for bots to pick up.
        //
        // Non-fatal on purpose. The BOT Message row is already committed above,
        // so aborting here would turn the retry into a human recovery rather than
        // giving this attempt the chance to complete its intended delivery. Log
        // it, remember it, and keep going so delivery can still happen.
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

        let responseDelivered = false;
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
            // Shadow mode's intended sink is the SYSTEM row. Preserve its
            // historical fail-soft behavior even if that diagnostic write fails.
            responseDelivered = true;
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
                    responseDelivered = true;
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
        } else {
            // For sources without adapters, suggestedResponse is the durable sink.
            if (suggestedResponseError) {
                deliveryFailure = `no platform adapter for ${ticket.source} and suggestedResponse could not be stored: ${suggestedResponseError}`;
            } else {
                responseDelivered = true;
            }
        }

        if (responseDelivered) {
            try {
                await prisma.message.update({
                    where: { id: aiMessage.id },
                    data: { responseState: 'DELIVERED', responseError: null },
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                deliveryFailure = `response was posted but its durable delivery state could not be recorded: ${message}`;
                console.error(
                    `[AI Response] Failed to record durable delivery for ticket ${ticketId}:`,
                    message,
                );
            }
        }

        if (deliveryFailure) {
            try {
                await prisma.message.update({
                    where: { id: aiMessage.id },
                    data: { responseError: deliveryFailure },
                });
            } catch (error) {
                console.error(
                    `[AI Response] Failed to record delivery error for ticket ${ticketId}:`,
                    error instanceof Error ? error.message : String(error),
                );
            }
        }

        await context.reportProgress(85);

        // 6. Enqueue ESCALATION when platform delivery failed, when the response
        // was withheld, or when confidence is below threshold — in the first two
        // cases nothing useful reached the reporter, so a human has to pick it up
        // regardless of what the score says. Delivery failure wins the reason slot
        // because it is the most actionable: the answer exists but is undelivered.
        // A retry will escalate a response left PENDING, never post it again.
        const escalationReason = deliveryFailure
            ? `AI response generated but not delivered to ${ticket.source} (${deliveryFailure}) — needs a human to answer the reporter`
            : pipelineResult.suppressed
              ? `AI response withheld (${pipelineResult.groundedness.reasons.join('; ')}) — needs a human answer`
              : pipelineResult.confidenceScore < AI_CONFIDENCE.ESCALATE
                ? `Low AI confidence (${(pipelineResult.confidenceScore * 100).toFixed(0)}%) — automated escalation`
                : null;

        let escalationEnqueued = false;
        if (escalationReason) {
            try {
                await createJob(JobType.ESCALATION, {
                    ticketId: ticket.id,
                    reason: escalationReason,
                });
                escalationEnqueued = true;
            } catch (error) {
                escalationEnqueueError = error instanceof Error ? error.message : String(error);
                console.error(
                    `[AI Response] Failed to create escalation job for ticket ${ticketId}:`,
                    escalationEnqueueError,
                );
            }
        }

        if (deliveryFailure && escalationEnqueued) {
            try {
                await prisma.message.update({
                    where: { id: aiMessage.id },
                    data: { responseState: 'ESCALATED' },
                });
            } catch (error) {
                // The escalation job already exists, so the safety outcome is
                // durable even if this state mirror cannot be updated.
                console.error(
                    `[AI Response] Failed to mark response escalated for ticket ${ticketId}:`,
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
            `(${(pipelineResult.confidenceScore * 100).toFixed(0)}%), latency=${pipelineResult.latencyMs}ms` +
            `${pipelineResult.suppressed ? ', ungrounded draft withheld' : ''}` +
            `${deliveryFailure ? `, delivery failed (${deliveryFailure})` : ''}`,
    );

    const escalated =
        deliveryFailure !== null ||
        pipelineResult.suppressed ||
        pipelineResult.confidenceScore < AI_CONFIDENCE.ESCALATE;

    // An undelivered answer with no escalation behind it is the one outcome that
    // leaves the reporter silent and no human involved. Report failure so the
    // queue retries it; that retry sees the PENDING response and durably hands the
    // thread to a human without posting again. Other escalation-enqueue failures
    // keep the historical success result because the response reached the reporter.
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
