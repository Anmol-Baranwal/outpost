import { NextRequest, NextResponse } from 'next/server';
import { findMockAgent } from '@/lib/mock-agents';

/**
 * POST /api/agents/[id]/run
 *
 * Manually trigger an agent run. In production this would enqueue a job
 * via the job queue and the job handler would execute the configured action.
 */
export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const agent = findMockAgent(id);

    if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // In production:
    // 1. Enqueue a job for this agent's action type
    // 2. The job handler would call the configured action (classify, SLA check, FAQ gen, or webhook)
    // 3. Update agent.lastRun and agent.status based on result

    const result = {
        agentId: agent.id,
        agentName: agent.name,
        actionType: agent.config.actionType,
        status: 'queued',
        triggeredAt: new Date().toISOString(),
        message: `Agent "${agent.name}" run has been queued. Action: ${agent.config.actionType}`,
    };

    return NextResponse.json(result, { status: 202 });
}
