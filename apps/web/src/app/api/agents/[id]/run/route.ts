import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';

/**
 * POST /api/agents/[id]/run
 *
 * Manually trigger an agent run. Validates the agent exists and updates
 * its lastRun timestamp. In a full implementation, this would also
 * enqueue a job via the job queue for the configured action type.
 */
export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const agent = await prisma.agent.findUnique({ where: { id } });

    if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const config = agent.config as Record<string, unknown> | null;
    const actionType = config?.actionType ?? 'unknown';

    // Update the agent's lastRun timestamp
    await prisma.agent.update({
        where: { id },
        data: { lastRun: new Date() },
    });

    const result = {
        agentId: agent.id,
        agentName: agent.name,
        actionType,
        status: 'queued',
        triggeredAt: new Date().toISOString(),
        message: `Agent "${agent.name}" run has been queued. Action: ${actionType}`,
    };

    return NextResponse.json(result, { status: 202 });
}
