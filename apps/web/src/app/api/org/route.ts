import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@copilotkit/outpost/db';

export async function GET() {
    const org = await prisma.organization.findFirst();
    if (!org) {
        return NextResponse.json({ error: 'Organization not configured.' }, { status: 404 });
    }

    return NextResponse.json({
        id: org.id,
        name: org.name,
        email: org.email,
        logoUrl: org.logoUrl,
        tagline: org.tagline,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt,
    });
}

export async function PUT(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as Record<string, unknown>;
    if (user.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const org = await prisma.organization.findFirst();
    if (!org) {
        return NextResponse.json({ error: 'Organization not configured.' }, { status: 404 });
    }

    const body = await request.json();
    const { name, email, logoUrl, tagline } = body;

    const errors: string[] = [];

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
        errors.push('Name must be a non-empty string.');
    }

    if (email !== undefined) {
        if (typeof email !== 'string') {
            errors.push('Email must be a string.');
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            errors.push('Email must be a valid email address.');
        }
    }

    if (errors.length > 0) {
        return NextResponse.json({ errors }, { status: 400 });
    }

    const updated = await prisma.organization.update({
        where: { id: org.id },
        data: {
            ...(name !== undefined && { name: name.trim() }),
            ...(email !== undefined && { email: email.trim().toLowerCase() }),
            ...(logoUrl !== undefined && { logoUrl: logoUrl?.trim() || null }),
            ...(tagline !== undefined && { tagline: tagline?.trim() || null }),
        },
    });

    return NextResponse.json({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        logoUrl: updated.logoUrl,
        tagline: updated.tagline,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
    });
}
