import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireAdmin } from '@/lib/require-admin';
import { prisma } from '@copilotkit/outpost/db';
import { TicketStatus, TicketPriority } from '@copilotkit/outpost/shared';

/**
 * Default mapping configuration, used when nothing has been persisted
 * to SystemConfig yet (see PUT below, which persists real overrides).
 * Identity mappings always come live from ExternalIdentity records.
 */
const DEFAULT_STATUS_MAPPINGS: Record<
    string,
    Array<{ externalStatus: string; outpostStatus: string }>
> = {
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

const DEFAULT_PRIORITY_MAPPINGS: Record<
    string,
    Array<{ externalPriority: string; outpostPriority: string }>
> = {
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

const DEFAULT_LABEL_RULES: Record<
    string,
    Array<{ externalPrefix: string; outpostPrefix: string }>
> = {
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

const MAPPING_CONFIG_KEY = 'sync.mappingConfig';

interface PersistedMappingConfig {
    statusMappings: typeof DEFAULT_STATUS_MAPPINGS;
    priorityMappings: typeof DEFAULT_PRIORITY_MAPPINGS;
    labelRules?: typeof DEFAULT_LABEL_RULES;
}

/**
 * Outcome of reading the persisted mapping config.
 *
 * `absent` and `corrupt` are deliberately distinct. Collapsing both to null made
 * a row that exists but cannot be used indistinguishable from "never configured":
 * GET served the code defaults, the dashboard rendered them as if they were the
 * saved settings, and an admin's configuration appeared to silently revert with
 * nothing in the logs. This endpoint exists partly because the old one accepted
 * edits and threw them away — the same failure shape must not return on the read
 * path.
 */
type PersistedConfigRead =
    | { status: 'absent' }
    | { status: 'corrupt'; reason: string }
    | { status: 'ok'; config: PersistedMappingConfig; invalidSections: string[] };

async function readPersistedConfig(): Promise<PersistedConfigRead> {
    const row = await prisma.systemConfig.findUnique({ where: { key: MAPPING_CONFIG_KEY } });
    if (!row) return { status: 'absent' };

    let parsed: unknown;
    try {
        parsed = JSON.parse(row.value);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(
            `[sync/mappings] SystemConfig row "${MAPPING_CONFIG_KEY}" is not valid JSON — ` +
                `serving code defaults and IGNORING the persisted config: ${reason}`,
        );
        return { status: 'corrupt', reason: 'row is not valid JSON' };
    }

    // The PUT path validates before writing, but a row written by an older
    // version of this code — or hand-edited in the database — reaches the worker
    // unvalidated. Re-validate on read rather than trusting the cast.
    //
    // Validated PER SECTION: a row whose priorityMappings are unusable should not
    // discard perfectly good statusMappings. Each bad section falls back to the
    // code defaults on its own and says which one it was.
    const candidate = parsed as PersistedMappingConfig;
    const bad: string[] = [];

    if (!isValidMappingShape(candidate?.statusMappings, Object.values(TicketStatus))) {
        bad.push('statusMappings');
    }
    if (!isValidMappingShape(candidate?.priorityMappings, Object.values(TicketPriority))) {
        bad.push('priorityMappings');
    }

    if (bad.length > 0) {
        console.error(
            `[sync/mappings] SystemConfig row "${MAPPING_CONFIG_KEY}" has unusable section(s): ` +
                `${bad.join(', ')} — serving code defaults for those and keeping the rest.`,
        );
    }

    return {
        status: 'ok',
        config: {
            ...candidate,
            ...(bad.includes('statusMappings') ? { statusMappings: undefined } : {}),
            ...(bad.includes('priorityMappings') ? { priorityMappings: undefined } : {}),
        } as PersistedMappingConfig,
        invalidSections: bad,
    };
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

    const identityMappings = identities.map((ei: (typeof identities)[number]) => ({
        id: ei.id,
        externalPlugin: ei.plugin,
        externalUserId: ei.externalId,
        externalDisplayName: ei.externalId,
        memberId: ei.member?.id ?? null,
        memberName: ei.member?.name ?? null,
    }));

    const persisted = await readPersistedConfig();
    const config = persisted.status === 'ok' ? persisted.config : null;

    return NextResponse.json({
        statusMappings: config?.statusMappings ?? DEFAULT_STATUS_MAPPINGS,
        priorityMappings: config?.priorityMappings ?? DEFAULT_PRIORITY_MAPPINGS,
        identityMappings,
        labelRules: config?.labelRules ?? DEFAULT_LABEL_RULES,
        // Tells the caller these ARE the code defaults and why, so the dashboard
        // can say so instead of presenting them as the saved configuration.
        configSource: persisted.status === 'ok' ? 'persisted' : 'defaults',
        ...(persisted.status === 'corrupt' ? { configError: persisted.reason } : {}),
        // Names the sections that fell back, so the dashboard can mark those as
        // defaults instead of presenting them as saved settings.
        ...(persisted.status === 'ok' && persisted.invalidSections.length > 0
            ? { invalidSections: persisted.invalidSections }
            : {}),
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

        // An empty per-plugin array is rejected, not accepted-as-vacuously-valid.
        // `loadStatusMap` / `loadPriorityMap` treat `entries.length === 0` as
        // "nothing persisted, use the hardcoded defaults" (status-map.ts:131), so
        // saving `{ linear: [] }` would leave the dashboard showing NO mappings
        // while the worker kept applying the Linear defaults. Same reason the
        // empty-object case above is rejected: a save must not be able to produce
        // a state where the UI and the engine disagree about what is in effect.
        if (entries.length === 0) return false;

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

    if (Object.keys(value as Record<string, unknown>).length === 0) {
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

    let body: { statusMappings?: unknown; priorityMappings?: unknown; labelRules?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

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
        return NextResponse.json({ error: 'labelRules has invalid shape' }, { status: 400 });
    }

    const config: PersistedMappingConfig = {
        statusMappings: body.statusMappings as PersistedMappingConfig['statusMappings'],
        priorityMappings: body.priorityMappings as PersistedMappingConfig['priorityMappings'],
        ...(body.labelRules
            ? { labelRules: body.labelRules as PersistedMappingConfig['labelRules'] }
            : {}),
    };
    const value = JSON.stringify(config);

    await prisma.systemConfig.upsert({
        where: { key: MAPPING_CONFIG_KEY },
        update: { value },
        create: { key: MAPPING_CONFIG_KEY, value },
    });

    return NextResponse.json(config);
}
