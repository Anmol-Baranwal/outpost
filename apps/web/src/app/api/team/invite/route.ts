import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { requireAdmin } from '@/lib/require-admin';

export async function POST(request: Request) {
    const { error, session } = await requireAdmin();
    if (error) return error;

    const body = await request.json();
    const { email, role } = body;

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    const validRole = role && ['ADMIN', 'MEMBER'].includes(role) ? role : 'MEMBER';

    // Check for existing member with this email
    const existing = await prisma.teamMember.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (existing) {
        return NextResponse.json({ error: 'A team member with this email already exists' }, { status: 409 });
    }

    const inviterId = (session!.user as Record<string, unknown>).memberId as string;
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const member = await prisma.teamMember.create({
        data: {
            name: '',
            email: email.trim().toLowerCase(),
            role: validRole,
            status: 'INVITED',
            invitedBy: inviterId,
            invitedAt: new Date(),
            inviteTokens: {
                create: {
                    token,
                    expiresAt,
                },
            },
        },
        include: {
            inviteTokens: true,
        },
    });

    // TODO: Send invite email via template system
    const inviteUrl = `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/invite/accept?token=${token}`;
    console.log(`[INVITE] Invite email for ${email}: ${inviteUrl}`);

    return NextResponse.json({
        id: member.id,
        email: member.email,
        role: member.role,
        status: member.status,
        invitedAt: member.invitedAt,
        inviteUrl,
    });
}
