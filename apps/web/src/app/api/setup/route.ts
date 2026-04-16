import { NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';
import { hashPassword } from '@copilotkit/outpost/shared';

export async function POST(request: Request) {
    // Guard: only allow setup when no team members exist
    const existingCount = await prisma.teamMember.count();
    if (existingCount > 0) {
        return NextResponse.json(
            { error: 'Setup already completed. An admin account already exists.' },
            { status: 403 },
        );
    }

    const body = await request.json();
    const { name, email, password, confirmPassword } = body;

    // Validate required fields
    const errors: string[] = [];

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        errors.push('Name is required.');
    }

    if (!email || typeof email !== 'string') {
        errors.push('Email is required.');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push('Email must be a valid email address.');
    }

    if (!password || typeof password !== 'string') {
        errors.push('Password is required.');
    } else if (password.length < 8) {
        errors.push('Password must be at least 8 characters.');
    }

    if (password !== confirmPassword) {
        errors.push('Passwords do not match.');
    }

    if (errors.length > 0) {
        return NextResponse.json({ errors }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);

    const member = await prisma.teamMember.create({
        data: {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            passwordHash,
            role: 'ADMIN',
        },
    });

    return NextResponse.json({
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        createdAt: member.createdAt,
    });
}
