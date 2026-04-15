import { NextRequest, NextResponse } from 'next/server';
import { dryRunRouting, DEFAULT_ROUTING_RULES } from '@outpost/shared';
import type { RoutingTicket, RoutingTeamMember } from '@outpost/shared';

/**
 * POST /api/dispatch/evaluate
 *
 * Dry-run routing evaluation for a ticket. Tests which routing rule
 * would match and which team member would be assigned, without
 * actually modifying any data.
 *
 * Body: { ticket: RoutingTicket, teamMembers: RoutingTeamMember[] }
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        if (!body.ticket) {
            return NextResponse.json(
                { error: 'ticket is required in request body' },
                { status: 400 },
            );
        }

        const ticket = body.ticket as RoutingTicket;
        const teamMembers = (body.teamMembers ?? []) as RoutingTeamMember[];

        if (!ticket.id || !ticket.title || !ticket.description) {
            return NextResponse.json(
                { error: 'ticket must include id, title, and description' },
                { status: 400 },
            );
        }

        const result = dryRunRouting(ticket, teamMembers);

        return NextResponse.json({
            result,
            rulesEvaluated: DEFAULT_ROUTING_RULES.filter((r) => r.enabled).length,
        });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
