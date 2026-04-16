import { NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { requireAdmin } from '@/lib/require-admin';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { error, session } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const body = await request.json();
    const { role, status } = body;

    // Prevent self-demotion
    const memberId = (session!.user as Record<string, unknown>).memberId;
    if (id === memberId && role && role !== 'ADMIN') {
        return NextResponse.json(
            { error: 'Cannot change your own role' },
            { status: 400 },
        );
    }

    const data: Record<string, unknown> = {};
    if (role && ['ADMIN', 'MEMBER'].includes(role)) {
        data.role = role;
    }
    if (status && ['ACTIVE', 'DISABLED'].includes(status)) {
        data.status = status;
    }

    if (Object.keys(data).length === 0) {
        return NextResponse.json(
            { error: 'No valid fields to update' },
            { status: 400 },
        );
    }

    const member = await prisma.teamMember.update({
        where: { id },
        data,
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
        },
    });

    return NextResponse.json(member);
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { error, session } = await requireAdmin();
    if (error) return error;

    const { id } = await params;

    // Prevent self-removal
    const memberId = (session!.user as Record<string, unknown>).memberId;
    if (id === memberId) {
        return NextResponse.json(
            { error: 'Cannot remove yourself' },
            { status: 400 },
        );
    }

    await prisma.teamMember.delete({ where: { id } });

    return NextResponse.json({ success: true });
}
