/**
 * Escalation job handler.
 *
 * Consumes ESCALATION jobs from the queue, runs the routing engine
 * to determine who should handle the ticket, updates the assignee,
 * and creates a note on the ticket documenting the routing decision.
 */

import { prisma } from '@outpost/db';
import {
    evaluateRouting,
    TeamMemberRole,
} from '@outpost/shared';
import type {
    RoutingTicket,
    RoutingTeamMember,
} from '@outpost/shared';
import type { EscalationPayload, JobResult, JobHandlerContext } from '../types.js';

/**
 * Handle an ESCALATION job.
 *
 * 1. Load the ticket and its account from the database
 * 2. If the escalation specifies a targetTeamMemberId, use that directly
 * 3. Otherwise, run the routing engine to determine the best assignee
 * 4. Update the ticket assignee
 * 5. Create a note documenting the routing decision
 */
export async function handleEscalation(
    payload: EscalationPayload,
    context: JobHandlerContext,
): Promise<JobResult> {
    const { ticketId, reason, targetTeamMemberId } = payload;

    await context.reportProgress(10);

    // Load ticket with account info for routing
    const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: {
            account: {
                select: {
                    id: true,
                    acv: true,
                    owner: true,
                },
            },
        },
    });

    if (!ticket) {
        return {
            success: false,
            error: `Ticket ${ticketId} not found`,
        };
    }

    await context.reportProgress(30);

    let assigneeId: string | null = null;
    let routingReason: string;

    if (targetTeamMemberId) {
        // Direct assignment requested
        assigneeId = targetTeamMemberId;
        routingReason = `Directly assigned via escalation: ${reason}`;
    } else {
        // Run routing engine
        const teamMembers = await loadTeamMembers();

        await context.reportProgress(50);

        const routingTicket: RoutingTicket = {
            id: ticket.id,
            title: ticket.title,
            description: ticket.description,
            source: ticket.source,
            type: ticket.type,
            priority: ticket.priority,
            account: ticket.account,
        };

        const result = evaluateRouting(routingTicket, teamMembers);
        assigneeId = result.targetMemberId;
        routingReason = result.reason;
    }

    await context.reportProgress(70);

    // Update ticket assignee and status
    await prisma.ticket.update({
        where: { id: ticketId },
        data: {
            assigneeId,
            status: 'IN_PROGRESS',
        },
    });

    await context.reportProgress(85);

    // Create a note documenting the routing decision
    await prisma.note.create({
        data: {
            ticketId,
            author: 'system',
            content: [
                `**Escalation routed**`,
                `Reason: ${reason}`,
                `Routing: ${routingReason}`,
                assigneeId
                    ? `Assigned to team member: ${assigneeId}`
                    : `No assignee found — ticket left unassigned`,
            ].join('\n'),
        },
    });

    await context.reportProgress(100);

    console.log(
        `[Escalation] Ticket ${ticketId} routed: ${routingReason} (assignee: ${assigneeId ?? 'none'})`,
    );

    return {
        success: true,
        data: {
            ticketId,
            assigneeId,
            reason: routingReason,
        },
    };
}

/**
 * Load all active team members for routing decisions.
 */
async function loadTeamMembers(): Promise<RoutingTeamMember[]> {
    const members = await prisma.teamMember.findMany({
        select: {
            id: true,
            name: true,
            role: true,
        },
    });

    return members.map((m: { id: string; name: string; role: string }) => ({
        id: m.id,
        name: m.name,
        role: m.role as TeamMemberRole,
    }));
}
