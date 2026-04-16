import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { requireAdmin } from '@/lib/require-admin';

export async function POST(request: Request) {
    const { error } = await requireAdmin();
    if (error) return error;

    const body = await request.json();
    const { memberId } = body;

    if (!memberId) {
        return NextResponse.json({ error: 'memberId is required' }, { status: 400 });
    }

    const member = await prisma.teamMember.findUnique({
        where: { id: memberId },
    });

    if (!member || member.status !== 'INVITED') {
        return NextResponse.json({ error: 'No pending invitation found for this member' }, { status: 404 });
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    // Delete old token and create new one
    await prisma.inviteToken.deleteMany({ where: { memberId } });
    await prisma.inviteToken.create({
        data: {
            memberId,
            token,
            expiresAt,
        },
    });

    const inviteUrl = `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/invite/accept?token=${token}`;
    console.log(`[INVITE] Resend invite email for ${member.email}: ${inviteUrl}`);

    return NextResponse.json({ success: true, inviteUrl });
}
