import { ChannelType, type ButtonInteraction } from 'discord.js';
import { prisma } from '@copilotkit/outpost/db';
import { createJob, JobType } from '@copilotkit/outpost/queue';
import { findTicketByThreadId } from '../lib/tickets.js';

export async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const handlers: Record<string, (i: ButtonInteraction) => Promise<void>> = {
        issue_solved: handleIssueSolved,
        need_more_help: handleNeedMoreHelp,
        // Buttons emitted by the shared AI formatter (packages/outpost/ai/formatter.ts)
        feedback_positive: handleFeedbackPositive,
        feedback_negative: handleFeedbackNegative,
        escalate: handleEscalate,
    };

    const handler = handlers[interaction.customId];
    if (!handler) return;

    try {
        await handler(interaction);
    } catch (error) {
        console.error(`[Discord Bot] Error handling button ${interaction.customId}:`, error);
        const errorMessage = {
            content: 'An error occurred while processing your request.',
            ephemeral: true,
        };
        try {
            // The handler may already have deferred/replied — resolve that ack
            // instead of double-acking (which throws) or leaving the deferred
            // "thinking…" placeholder hanging forever.
            if (interaction.deferred && !interaction.replied) {
                // editReply can't set ephemeral (fixed at defer time), so drop it.
                await interaction.editReply({ content: errorMessage.content });
            } else if (interaction.replied) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        } catch (replyError) {
            console.error(
                `[Discord Bot] Failed to send error reply for button ${interaction.customId}:`,
                replyError,
            );
        }
    }
}

async function recordFeedback(ticketId: string, feedback: 'POSITIVE' | 'NEGATIVE'): Promise<void> {
    const latestAiMessage = await prisma.message.findFirst({
        where: { ticketId, isAiGenerated: true, feedback: null },
        orderBy: { createdAt: 'desc' },
    });

    if (latestAiMessage) {
        await prisma.message.update({
            where: { id: latestAiMessage.id },
            data: { feedback },
        });
    }
}

async function handleIssueSolved(interaction: ButtonInteraction): Promise<void> {
    const threadId = getThreadId(interaction);
    if (!threadId) {
        await interaction.reply({
            content: 'This button can only be used inside a support thread.',
            ephemeral: true,
        });
        return;
    }

    const ticket = await findTicketByThreadId(threadId);
    if (!ticket) {
        await interaction.reply({
            content: 'No ticket found for this thread.',
            ephemeral: true,
        });
        return;
    }

    // Update ticket status to CLOSED
    await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'CLOSED' },
    });

    await recordFeedback(ticket.id, 'POSITIVE');

    // Log the resolution as a system message
    await prisma.message.create({
        data: {
            ticketId: ticket.id,
            author: `${interaction.user.tag} (${interaction.user.id})`,
            content: 'Issue marked as solved by user.',
            type: 'SYSTEM',
        },
    });

    await interaction.reply({
        content: 'Glad we could help! \uD83C\uDF89',
        ephemeral: false,
    });

    console.log(`[Discord Bot] Ticket ${ticket.displayId} closed via "Issue Solved" button`);
}

async function handleNeedMoreHelp(interaction: ButtonInteraction): Promise<void> {
    const threadId = getThreadId(interaction);
    if (!threadId) {
        await interaction.reply({
            content: 'This button can only be used inside a support thread.',
            ephemeral: true,
        });
        return;
    }

    const ticket = await findTicketByThreadId(threadId);
    if (!ticket) {
        await interaction.reply({
            content: 'No ticket found for this thread.',
            ephemeral: true,
        });
        return;
    }

    // Update ticket to waiting on team
    await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'WAITING_ON_TEAM' },
    });

    await recordFeedback(ticket.id, 'NEGATIVE');

    // Enqueue an escalation notification
    await createJob(JobType.ESCALATION, {
        ticketId: ticket.id,
        reason: `User requested more help via "Need more help" button in thread ${threadId}`,
    });

    // Log the escalation
    await prisma.message.create({
        data: {
            ticketId: ticket.id,
            author: `${interaction.user.tag} (${interaction.user.id})`,
            content: 'User requested more help. Escalating to team.',
            type: 'SYSTEM',
        },
    });

    await interaction.reply({
        content: 'A team member has been notified and will follow up shortly.',
        ephemeral: false,
    });

    console.log(`[Discord Bot] Ticket ${ticket.displayId} escalated via "Need more help" button`);
}

async function handleFeedbackPositive(interaction: ButtonInteraction): Promise<void> {
    await recordFeedbackSignal(
        interaction,
        'POSITIVE',
        'User marked the AI response as Helpful.',
        'Thanks for the feedback — glad this helped! 👍',
    );
}

async function handleFeedbackNegative(interaction: ButtonInteraction): Promise<void> {
    await recordFeedbackSignal(
        interaction,
        'NEGATIVE',
        'User marked the AI response as Not Helpful (possible knowledge gap).',
        "Thanks for the feedback — we'll use it to improve. Still stuck? Tap 🧑‍💻 Talk to Human.",
    );
}

/**
 * Record a 👍/👎 feedback signal on the latest AI message. Feedback is a signal
 * to the team about whether the agent delivered a fix and whether there's a
 * knowledge gap to close — it does NOT change ticket status.
 */
async function recordFeedbackSignal(
    interaction: ButtonInteraction,
    feedback: 'POSITIVE' | 'NEGATIVE',
    systemNote: string,
    ackText: string,
): Promise<void> {
    const threadId = getThreadId(interaction);
    if (!threadId) {
        await interaction.reply({
            content: 'This button can only be used inside a support thread.',
            ephemeral: true,
        });
        return;
    }

    // Ack immediately so a slow DB can't trip Discord's 3s interaction timeout.
    await interaction.deferReply({ ephemeral: true });

    const ticket = await findTicketByThreadId(threadId);
    if (!ticket) {
        await interaction.editReply({ content: 'No ticket found for this thread.' });
        return;
    }

    await recordFeedback(ticket.id, feedback);

    // Log the feedback signal so the team sees it on the ticket timeline.
    await prisma.message.create({
        data: {
            ticketId: ticket.id,
            author: `${interaction.user.tag} (${interaction.user.id})`,
            content: systemNote,
            type: 'SYSTEM',
        },
    });

    await interaction.editReply({ content: ackText });

    console.log(`[Discord Bot] Ticket ${ticket.displayId} feedback recorded: ${feedback}`);
}

/**
 * "Talk to Human" — the user opts out of the AI loop. Mark the ticket as waiting
 * on the team, enqueue an escalation (routing), and record on the ticket that the
 * user asked for a human so a team member can pick it up and respond in-community.
 */
async function handleEscalate(interaction: ButtonInteraction): Promise<void> {
    const threadId = getThreadId(interaction);
    if (!threadId) {
        await interaction.reply({
            content: 'This button can only be used inside a support thread.',
            ephemeral: true,
        });
        return;
    }

    await interaction.deferReply();

    const ticket = await findTicketByThreadId(threadId);
    if (!ticket) {
        await interaction.editReply({ content: 'No ticket found for this thread.' });
        return;
    }

    await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'WAITING_ON_TEAM' },
    });

    await createJob(JobType.ESCALATION, {
        ticketId: ticket.id,
        reason: `User requested a human via "Talk to Human" button in Discord thread ${threadId}`,
    });

    await prisma.message.create({
        data: {
            ticketId: ticket.id,
            author: `${interaction.user.tag} (${interaction.user.id})`,
            content: 'User opted to escalate to a human via "Talk to Human". Routing for a community response.',
            type: 'SYSTEM',
        },
    });

    await interaction.editReply({
        content: 'We have escalated this request to one of the team members. 🧑‍💻',
    });

    console.log(`[Discord Bot] Ticket ${ticket.displayId} escalated via "Talk to Human" button`);
}

function getThreadId(interaction: ButtonInteraction): string | null {
    const channel = interaction.channel;
    if (!channel) return null;
    if (channel.type === ChannelType.PublicThread || channel.type === ChannelType.PrivateThread) {
        return channel.id;
    }
    return null;
}
