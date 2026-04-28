import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@copilotkit/outpost/db';

/**
 * Default mapping configuration. In a full implementation this would
 * come from a dedicated settings/config table. For now we derive
 * identity mappings from ExternalIdentity records and keep
 * status/priority/label mappings as code defaults.
 */
const DEFAULT_STATUS_MAPPINGS: Record<string, Array<{ externalStatus: string; outpostStatus: string }>> = {
    linear: [
        { externalStatus: 'Triage', outpostStatus: 'OPEN' },
        { externalStatus: 'Backlog', outpostStatus: 'OPEN' },
        { externalStatus: 'Todo', outpostStatus: 'OPEN' },
        { externalStatus: 'In Progress', outpostStatus: 'IN_PROGRESS' },
        { externalStatus: 'Done', outpostStatus: 'RESOLVED' },
        { externalStatus: 'Canceled', outpostStatus: 'CLOSED' },
    ],
    github: [
        { externalStatus: 'open', outpostStatus: 'OPEN' },
        { externalStatus: 'closed', outpostStatus: 'CLOSED' },
    ],
};

const DEFAULT_PRIORITY_MAPPINGS: Record<string, Array<{ externalPriority: string; outpostPriority: string }>> = {
    linear: [
        { externalPriority: '0 (None)', outpostPriority: 'MEDIUM' },
        { externalPriority: '1 (Urgent)', outpostPriority: 'CRITICAL' },
        { externalPriority: '2 (High)', outpostPriority: 'HIGH' },
        { externalPriority: '3 (Medium)', outpostPriority: 'MEDIUM' },
        { externalPriority: '4 (Low)', outpostPriority: 'LOW' },
    ],
    github: [
        { externalPriority: 'critical', outpostPriority: 'CRITICAL' },
        { externalPriority: 'high', outpostPriority: 'HIGH' },
        { externalPriority: 'medium', outpostPriority: 'MEDIUM' },
        { externalPriority: 'low', outpostPriority: 'LOW' },
    ],
};

const DEFAULT_LABEL_RULES: Record<string, Array<{ externalPrefix: string; outpostPrefix: string }>> = {
    github: [
        { externalPrefix: 'priority:', outpostPrefix: '' },
        { externalPrefix: 'type:', outpostPrefix: '' },
        { externalPrefix: 'area/', outpostPrefix: '' },
    ],
    linear: [
        { externalPrefix: 'Priority: ', outpostPrefix: '' },
        { externalPrefix: 'Type: ', outpostPrefix: '' },
    ],
};

/**
 * GET /api/sync/mappings
 *
 * Returns the current mapping configuration. Identity mappings
 * are fetched from the ExternalIdentity table; status/priority/label
 * mappings are code defaults.
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch identity mappings from ExternalIdentity records
    const identities = await prisma.externalIdentity.findMany({
        include: { member: { select: { id: true, name: true } } },
    });

    const identityMappings = identities.map((ei: typeof identities[number]) => ({
        id: ei.id,
        externalPlugin: ei.plugin,
        externalUserId: ei.externalId,
        externalDisplayName: ei.externalId,
        memberId: ei.member?.id ?? null,
        memberName: ei.member?.name ?? null,
    }));

    return NextResponse.json({
        statusMappings: DEFAULT_STATUS_MAPPINGS,
        priorityMappings: DEFAULT_PRIORITY_MAPPINGS,
        identityMappings,
        labelRules: DEFAULT_LABEL_RULES,
    });
}

/**
 * PUT /api/sync/mappings
 *
 * Update the mapping configuration.
 * Body: MappingConfig (statusMappings, priorityMappings required)
 *
 * Note: This currently validates but does not persist changes to a DB table.
 * A settings/config model would be needed for full persistence.
 */
export async function PUT(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();

        // Basic validation
        if (!body.statusMappings || !body.priorityMappings) {
            return NextResponse.json(
                { error: 'statusMappings and priorityMappings are required' },
                { status: 400 },
            );
        }

        // TODO: Persist to a settings/config table once schema supports it
        return NextResponse.json(
            { error: 'Sync mapping persistence not yet implemented' },
            { status: 501 },
        );
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
