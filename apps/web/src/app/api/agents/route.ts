import { NextRequest, NextResponse } from 'next/server';
import { MOCK_AGENTS, filterMockAgents } from '@/lib/mock-agents';
import type { AgentActionType, AgentTriggerType } from '@/lib/mock-agents';

const VALID_TRIGGER_TYPES: AgentTriggerType[] = ['interval', 'cron', 'manual'];
const VALID_ACTION_TYPES: AgentActionType[] = [
    'classify_tickets',
    'check_sla',
    'generate_faq',
    'custom_webhook',
];

/**
 * GET /api/agents
 *
 * List all agents, with optional search filter.
 */
export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const search = searchParams.get('search') || undefined;
    const agents = filterMockAgents(search);
    return NextResponse.json({ agents, total: agents.length });
}

/**
 * POST /api/agents
 *
 * Create a new agent. Required: name, config.actionType, config.triggerType.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
            return NextResponse.json(
                { error: 'name is required' },
                { status: 400 },
            );
        }

        const config = body.config;
        if (!config || typeof config !== 'object') {
            return NextResponse.json(
                { error: 'config object is required' },
                { status: 400 },
            );
        }

        if (!VALID_TRIGGER_TYPES.includes(config.triggerType)) {
            return NextResponse.json(
                { error: `Invalid triggerType: ${config.triggerType}` },
                { status: 400 },
            );
        }

        if (!VALID_ACTION_TYPES.includes(config.actionType)) {
            return NextResponse.json(
                { error: `Invalid actionType: ${config.actionType}` },
                { status: 400 },
            );
        }

        const newAgent = {
            id: `agent-${Date.now()}`,
            name: body.name.trim(),
            description: body.description?.trim() || null,
            config,
            lastRun: null,
            status: 'ACTIVE',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        return NextResponse.json(newAgent, { status: 201 });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
