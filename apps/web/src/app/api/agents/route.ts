import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdmin } from '@/lib/require-admin';
import { prisma } from '@copilotkit/outpost/db';
import type { Prisma } from '@copilotkit/outpost/db';

type AgentTriggerType = 'interval' | 'cron' | 'manual';
type AgentActionType =
    | 'classify_tickets'
    | 'check_sla'
    | 'generate_faq'
    | 'custom_webhook';

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
    const { error } = await requireSession();
    if (error) return error;

    const { searchParams } = request.nextUrl;
    const search = searchParams.get('search') || undefined;

    const where: Prisma.AgentWhereInput = {};

    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
        ];
    }

    const agents = await prisma.agent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ agents, total: agents.length });
}

/**
 * POST /api/agents
 *
 * Create a new agent. Required: name, config.actionType, config.triggerType.
 */
export async function POST(request: NextRequest) {
    const { error } = await requireAdmin();
    if (error) return error;

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

        const newAgent = await prisma.agent.create({
            data: {
                name: body.name.trim(),
                description: body.description?.trim() || null,
                config: config as Prisma.InputJsonValue,
                status: 'ACTIVE',
            },
        });

        return NextResponse.json(newAgent, { status: 201 });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
