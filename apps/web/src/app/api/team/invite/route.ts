import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { requireAdmin } from '@/lib/require-admin';
import { sendEmail } from '@copilotkit/outpost/shared/server';

export async function POST(request: Request) {
    const { error, session } = await requireAdmin();
    if (error) return error;

    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { email, role } = body as { email?: string; role?: string };

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    const validRole = (role && ['ADMIN', 'MEMBER'].includes(role) ? role : 'MEMBER') as 'ADMIN' | 'MEMBER';

    try {
        // Check for existing member with this email
        const existing = await prisma.teamMember.findUnique({ where: { email: email.trim().toLowerCase() } });
        if (existing) {
            return NextResponse.json({ error: 'A team member with this email already exists' }, { status: 409 });
        }

        const inviterId = (session!.user as Record<string, unknown>).memberId as string;
        const inviter = await prisma.teamMember.findUnique({ where: { id: inviterId } });
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

        const inviteUrl = `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/invite/accept?token=${token}`;

        const responseData = {
            id: member.id,
            email: member.email,
            role: member.role,
            status: member.status,
            invitedAt: member.invitedAt,
            inviteUrl,
        };

        // Send invite email via template system
        const org = await prisma.organization.findFirst();
        try {
            const emailResult = await sendEmail({
                to: email.trim().toLowerCase(),
                template: 'invite',
                context: {
                    org: {
                        name: org?.name || 'Outpost',
                        email: org?.email || 'noreply@outpost.dev',
                    },
                    member: {
                        name: email.split('@')[0],
                        email: email.trim().toLowerCase(),
                        invitedBy: inviter?.name || 'A team member',
                        role: validRole,
                    },
                    invite: {
                        url: inviteUrl,
                        expiresIn: '1 hour',
                    },
                },
            });

            if (!emailResult.success) {
                console.warn(`[INVITE] Failed to send invite email to ${email}: ${emailResult.error}`);
                return NextResponse.json({ ...responseData, emailSent: false });
            }
        } catch (emailError) {
            console.warn('Failed to send invite email:', emailError);
            // Still return success (invite was created) but flag email failure
            return NextResponse.json({ ...responseData, emailSent: false });
        }

        return NextResponse.json(responseData);
    } catch (err) {
        console.error('[POST /api/team/invite] Error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
