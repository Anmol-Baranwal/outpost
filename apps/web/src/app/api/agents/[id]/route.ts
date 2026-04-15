import { NextRequest, NextResponse } from 'next/server';
import { findMockAgent } from '@/lib/mock-agents';
import type { AgentActionType, AgentTriggerType } from '@/lib/mock-agents';

const VALID_STATUSES = ['ACTIVE', 'PAUSED', 'ERROR'] as const;

/**
 * GET /api/agents/[id]
 *
 * Retrieve a single agent by ID.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const agent = findMockAgent(id);

    if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json(agent);
}

/**
 * PATCH /api/agents/[id]
 *
 * Update an agent's fields: name, description, config, status.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const agent = findMockAgent(id);

    if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    try {
        const body = await request.json();
        const updates: Record<string, unknown> = {};

        if ('name' in body) {
            if (typeof body.name !== 'string' || !body.name.trim()) {
                return NextResponse.json(
                    { error: 'name must be a non-empty string' },
                    { status: 400 },
                );
            }
            updates.name = body.name.trim();
        }

        if ('description' in body) {
            updates.description = body.description?.trim() || null;
        }

        if ('status' in body) {
            if (!VALID_STATUSES.includes(body.status)) {
                return NextResponse.json(
                    { error: `Invalid status: ${body.status}` },
                    { status: 400 },
                );
            }
            updates.status = body.status;
        }

        if ('config' in body) {
            updates.config = { ...agent.config, ...body.config };
        }

        const updatedAgent = {
            ...agent,
            ...updates,
            updatedAt: new Date().toISOString(),
        };

        return NextResponse.json(updatedAgent);
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}

/**
 * DELETE /api/agents/[id]
 *
 * Delete an agent.
 */
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const agent = findMockAgent(id);

    if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // In production this would use prisma.agent.delete()
    return NextResponse.json({ deleted: true, id });
}
