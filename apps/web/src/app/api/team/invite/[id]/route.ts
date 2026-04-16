import { NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { requireAdmin } from '@/lib/require-admin';

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;

    const member = await prisma.teamMember.findUnique({ where: { id } });
    if (!member || member.status !== 'INVITED') {
        return NextResponse.json({ error: 'No pending invitation found' }, { status: 404 });
    }

    // Delete the member (cascades to token)
    await prisma.teamMember.delete({ where: { id } });

    return NextResponse.json({ success: true });
}
