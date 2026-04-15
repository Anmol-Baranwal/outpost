import { NextResponse } from 'next/server';
import { DEFAULT_ROUTING_RULES } from '@outpost/shared';

/**
 * GET /api/dispatch/rules
 *
 * List the current routing rules. Returns the default rule set.
 * In the future this will support custom rules stored in the database.
 */
export async function GET() {
    return NextResponse.json({
        rules: DEFAULT_ROUTING_RULES,
        total: DEFAULT_ROUTING_RULES.length,
    });
}
