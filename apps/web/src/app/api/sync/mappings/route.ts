import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdmin } from '@/lib/require-admin';
import { prisma } from '@copilotkit/outpost/db';
import { TicketStatus, TicketPriority } from '@copilotkit/outpost/shared';

/**
 * Default mapping configuration, used when nothing has been persisted
 * to SystemConfig yet (see PUT below, which persists real overrides).
 * Identity mappings always come live from ExternalIdentity records.
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

export const MAPPING_CONFIG_KEY = 'sync.mappingConfig';

interface PersistedMappingConfig {
    statusMappings: typeof DEFAULT_STATUS_MAPPINGS;
    priorityMappings: typeof DEFAULT_PRIORITY_MAPPINGS;
    labelRules?: typeof DEFAULT_LABEL_RULES;
}

async function readPersistedConfig(): Promise<PersistedMappingConfig | null> {
    const row = await prisma.systemConfig.findUnique({ where: { key: MAPPING_CONFIG_KEY } });
    if (!row) return null;
    try {
        return JSON.parse(row.value) as PersistedMappingConfig;
    } catch {
        return null;
    }
}

/**
 * GET /api/sync/mappings
 *
 * Returns the current mapping configuration. Identity mappings are always
 * fetched live from the ExternalIdentity table. Status/priority/label
 * mappings come from the persisted SystemConfig row if one exists, else
 * the code defaults.
 */
export async function GET() {
    const { error } = await requireSession();
    if (error) return error;

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

    const persisted = await readPersistedConfig();

    return NextResponse.json({
        statusMappings: persisted?.statusMappings ?? DEFAULT_STATUS_MAPPINGS,
        priorityMappings: persisted?.priorityMappings ?? DEFAULT_PRIORITY_MAPPINGS,
        identityMappings,
        labelRules: persisted?.labelRules ?? DEFAULT_LABEL_RULES,
    });
}

/**
 * Validates that `value` matches the expected mapping shape:
 * a plain object whose values are arrays of
 * `{ externalStatus: string; outpostStatus: <one of validOutpostValues> }`
 * (or the priority equivalent, keyed `externalPriority`/`outpostPriority`).
 */
function isValidMappingShape(value: unknown, validOutpostValues: string[]): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    if (Object.keys(value as Record<string, unknown>).length === 0) {
        return false;
    }

    return Object.values(value as Record<string, unknown>).every((entries) => {
        if (!Array.isArray(entries)) return false;

        return entries.every((entry) => {
            if (typeof entry !== 'object' || entry === null) return false;
            const record = entry as Record<string, unknown>;
            const externalKey = 'externalStatus' in record ? 'externalStatus' : 'externalPriority';
            const outpostKey = 'externalStatus' in record ? 'outpostStatus' : 'outpostPriority';

            return (
                typeof record[externalKey] === 'string' &&
                typeof record[outpostKey] === 'string' &&
                validOutpostValues.includes(record[outpostKey] as string)
            );
        });
    });
}

/**
 * Validates that `value` matches the expected labelRules shape:
 * a plain object whose values are arrays of
 * `{ externalPrefix: string; outpostPrefix: string }`. Unlike
 * `isValidMappingShape`, there is no enum constraint on `outpostPrefix` —
 * any string (including empty string) is valid.
 */
function isValidLabelRulesShape(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    return Object.values(value as Record<string, unknown>).every((entries) => {
        if (!Array.isArray(entries)) return false;

        return entries.every((entry) => {
            if (typeof entry !== 'object' || entry === null) return false;
            const record = entry as Record<string, unknown>;

            return (
                typeof record.externalPrefix === 'string' &&
                typeof record.outpostPrefix === 'string'
            );
        });
    });
}

/**
 * PUT /api/sync/mappings
 *
 * Persists the mapping configuration as a single JSON row in SystemConfig.
 * Body: MappingConfig (statusMappings, priorityMappings required; labelRules optional)
 */
export async function PUT(request: NextRequest) {
    const { error } = await requireAdmin();
    if (error) return error;

    try {
        const body = await request.json();

        if (!body.statusMappings || !body.priorityMappings) {
            return NextResponse.json(
                { error: 'statusMappings and priorityMappings are required' },
                { status: 400 },
            );
        }

        if (!isValidMappingShape(body.statusMappings, Object.values(TicketStatus))) {
            return NextResponse.json(
                { error: 'statusMappings has invalid shape or unknown outpostStatus value' },
                { status: 400 },
            );
        }

        if (!isValidMappingShape(body.priorityMappings, Object.values(TicketPriority))) {
            return NextResponse.json(
                { error: 'priorityMappings has invalid shape or unknown outpostPriority value' },
                { status: 400 },
            );
        }

        if (body.labelRules !== undefined && !isValidLabelRulesShape(body.labelRules)) {
            return NextResponse.json(
                { error: 'labelRules has invalid shape' },
                { status: 400 },
            );
        }

        const config: PersistedMappingConfig = {
            statusMappings: body.statusMappings,
            priorityMappings: body.priorityMappings,
            ...(body.labelRules ? { labelRules: body.labelRules } : {}),
        };
        const value = JSON.stringify(config);

        await prisma.systemConfig.upsert({
            where: { key: MAPPING_CONFIG_KEY },
            update: { value },
            create: { key: MAPPING_CONFIG_KEY, value },
        });

        return NextResponse.json(config);
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
