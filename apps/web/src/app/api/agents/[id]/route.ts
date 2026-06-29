import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdmin } from '@/lib/require-admin';
import { prisma } from '@copilotkit/outpost/db';
import type { Prisma } from '@copilotkit/outpost/db';

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
    const { error } = await requireSession();
    if (error) return error;

    const { id } = await params;
    const agent = await prisma.agent.findUnique({ where: { id } });

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
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const agent = await prisma.agent.findUnique({ where: { id } });

    if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    try {
        const body = await request.json();
        const data: Prisma.AgentUpdateInput = {};

        if ('name' in body) {
            if (typeof body.name !== 'string' || !body.name.trim()) {
                return NextResponse.json(
                    { error: 'name must be a non-empty string' },
                    { status: 400 },
                );
            }
            data.name = body.name.trim();
        }

        if ('description' in body) {
            data.description = body.description?.trim() || null;
        }

        if ('status' in body) {
            if (!VALID_STATUSES.includes(body.status)) {
                return NextResponse.json(
                    { error: `Invalid status: ${body.status}` },
                    { status: 400 },
                );
            }
            data.status = body.status;
        }

        if ('config' in body) {
            const existingConfig = (agent.config && typeof agent.config === 'object') ? agent.config : {};
            data.config = { ...existingConfig, ...body.config } as Prisma.InputJsonValue;
        }

        const updatedAgent = await prisma.agent.update({
            where: { id },
            data,
        });

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
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const agent = await prisma.agent.findUnique({ where: { id } });

    if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    await prisma.agent.delete({ where: { id } });

    return NextResponse.json({ deleted: true, id });
}
