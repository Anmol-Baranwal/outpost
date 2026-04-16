import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';

export async function requireAdmin() {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
        return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), session: null };
    }

    const role = (session.user as Record<string, unknown>).role;
    if (role !== 'ADMIN') {
        return { error: NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 }), session: null };
    }

    return { error: null, session };
}
