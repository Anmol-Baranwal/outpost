import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { DEFAULT_ROUTING_RULES } from '@copilotkit/outpost/shared';

/**
 * GET /api/dispatch/rules
 *
 * List the current routing rules. Returns the default rule set.
 * In the future this will support custom rules stored in the database.
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({
        rules: DEFAULT_ROUTING_RULES,
        total: DEFAULT_ROUTING_RULES.length,
    });
}
