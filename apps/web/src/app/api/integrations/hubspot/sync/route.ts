import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

/**
 * POST /api/integrations/hubspot/sync
 *
 * Trigger a manual HubSpot sync. Optionally pass { domain } in the
 * request body to sync a single account instead of all accounts.
 *
 * In production this would enqueue a HUBSPOT_SYNC job. For now it
 * returns a mock response matching the SyncReport shape.
 */
export async function POST(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json().catch(() => ({}));
        const domain = typeof body.domain === 'string' ? body.domain : undefined;

        // In production: createJob(JobType.HUBSPOT_SYNC, { domain })
        // For now, return a mock sync-in-progress response
        const response = {
            status: 'queued',
            message: domain
                ? `HubSpot sync queued for domain: ${domain}`
                : 'Full HubSpot sync queued',
            queuedAt: new Date().toISOString(),
        };

        return NextResponse.json(response, { status: 202 });
    } catch {
        return NextResponse.json(
            { error: 'Failed to queue HubSpot sync' },
            { status: 500 },
        );
    }
}
