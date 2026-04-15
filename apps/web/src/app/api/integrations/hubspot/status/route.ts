import { NextResponse } from 'next/server';

/**
 * GET /api/integrations/hubspot/status
 *
 * Returns the current HubSpot integration status including connection
 * state, last sync time, and last sync results.
 *
 * In production this would query the Job table for the most recent
 * HUBSPOT_SYNC job. For now it returns a mock response.
 */
export async function GET() {
    // In production: query prisma.job.findFirst({ where: { type: 'HUBSPOT_SYNC' }, orderBy: { createdAt: 'desc' } })
    const connected = !!process.env.HUBSPOT_API_KEY;

    const response = {
        connected,
        lastSyncAt: connected ? null : null,
        lastSyncResult: connected
            ? null
            : null,
        message: connected
            ? 'HubSpot integration is configured'
            : 'HUBSPOT_API_KEY is not set',
    };

    return NextResponse.json(response);
}
