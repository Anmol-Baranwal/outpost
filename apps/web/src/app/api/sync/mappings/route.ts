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

/**
 * Priority mapping defaults.
 *
 * `externalPriority` MUST be the value the adapter actually receives, because the
 * dashboard PUTs back whatever GET served — so anything cosmetic in this key gets
 * persisted as a real lookup key and silently stops matching.
 *
 * For Linear that is the raw numeric priority: `LinearAdapter` maps with
 * `String(data.priority ?? '0')` (adapters/linear.ts:138) and
 * `createLinearPriorityMap()` is keyed '0'-'4' (priority-map.ts:71). These keys
 * previously read '0 (None)'-'4 (Low)', which no inbound webhook could ever
 * match: one save from the dashboard persisted a PriorityMap that matched nothing
 * and every inbound Linear priority silently fell through to MEDIUM.
 *
 * Human-readable text belongs in `label`, which is display-only — the editor
 * renders it and the loaders ignore it.
 */
const DEFAULT_PRIORITY_MAPPINGS: Record<
    string,
    Array<{ externalPriority: string; outpostPriority: string; label?: string }>
> = {
    linear: [
        { externalPriority: '0', outpostPriority: 'MEDIUM', label: 'None' },
        { externalPriority: '1', outpostPriority: 'CRITICAL', label: 'Urgent' },
        { externalPriority: '2', outpostPriority: 'HIGH', label: 'High' },
        { externalPriority: '3', outpostPriority: 'MEDIUM', label: 'Medium' },
        { externalPriority: '4', outpostPriority: 'LOW', label: 'Low' },
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
    // Optional because the read path strips any section that fails validation and
    // lets the caller fall back per section. Previously these were non-optional
    // and the strip was a type assertion over a field the type said was always
    // present — it worked only because every reader used `?? DEFAULT`.
    statusMappings?: typeof DEFAULT_STATUS_MAPPINGS;
    priorityMappings?: typeof DEFAULT_PRIORITY_MAPPINGS;
    labelRules?: typeof DEFAULT_LABEL_RULES;
}

/**
 * Outcome of reading the persisted mapping config.
 *
 * `absent` and `corrupt` are deliberately distinct. `corrupt` covers a row whose
 * JSON does not parse; a row that parses but whose SECTIONS fail validation comes
 * back as `ok` with those sections stripped and named in `invalidSections`, so the
 * good half survives. Callers decide "am I showing saved settings or defaults?"
 * from whether anything survived, not from `status` alone.
 *
 * Collapsing everything to null made a row that exists but cannot be used
 * indistinguishable from "never configured":
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

    if (
        !isValidMappingShape(
            candidate?.statusMappings,
            Object.values(TicketStatus),
            'externalStatus',
            'outpostStatus',
        )
    ) {
        bad.push('statusMappings');
    }
    if (
        !isValidMappingShape(
            candidate?.priorityMappings,
            Object.values(TicketPriority),
            'externalPriority',
            'outpostPriority',
        )
    ) {
        bad.push('priorityMappings');
    }

    if (bad.length > 0) {
        console.error(
            `[sync/mappings] SystemConfig row "${MAPPING_CONFIG_KEY}" has unusable section(s): ` +
                `${bad.join(', ')} — serving code defaults for those and keeping the rest.`,
        );
    }

    const usable: PersistedMappingConfig = { ...candidate };
    if (bad.includes('statusMappings')) delete usable.statusMappings;
    if (bad.includes('priorityMappings')) delete usable.priorityMappings;

    return { status: 'ok', config: usable, invalidSections: bad };
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
    const invalidSections = persisted.status === 'ok' ? persisted.invalidSections : [];

    // 'persisted' means at least one saved section survived validation. Deriving
    // it from `status === 'ok'` alone was wrong: a row whose JSON parsed but whose
    // every section failed reported 'persisted' with no configError, which is
    // precisely the "defaults presented as saved settings" case this field exists
    // to prevent.
    const anythingPersisted =
        persisted.status === 'ok' &&
        (config?.statusMappings !== undefined ||
            config?.priorityMappings !== undefined ||
            config?.labelRules !== undefined);

    return NextResponse.json({
        statusMappings: config?.statusMappings ?? DEFAULT_STATUS_MAPPINGS,
        priorityMappings: config?.priorityMappings ?? DEFAULT_PRIORITY_MAPPINGS,
        identityMappings,
        labelRules: config?.labelRules ?? DEFAULT_LABEL_RULES,
        configSource: anythingPersisted ? 'persisted' : 'defaults',
        ...(persisted.status === 'corrupt' ? { configError: persisted.reason } : {}),
        // Names the sections serving code defaults, so the dashboard can mark
        // those rather than presenting them as saved settings.
        ...(invalidSections.length > 0 ? { invalidSections } : {}),
    });
}

/**
 * Validates that `value` matches the expected mapping shape:
 * a plain object whose values are arrays of
 * `{ externalStatus: string; outpostStatus: <one of validOutpostValues> }`
 * (or the priority equivalent, keyed `externalPriority`/`outpostPriority`).
 */
function isValidMappingShape(
    value: unknown,
    validOutpostValues: string[],
    externalKey: 'externalStatus' | 'externalPriority' = 'externalStatus',
    outpostKey: 'outpostStatus' | 'outpostPriority' = 'outpostStatus',
): boolean {
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

            // Validate against the key pair this SECTION requires, not whichever
            // key the entry happens to carry. Picking the pair from the entry let
            // a priority-shaped row sit inside statusMappings and pass PUT, only
            // for loadStatusMap to drop it for having no externalStatus — the
            // accept-then-discard behaviour this endpoint exists to remove, moved
            // one layer down.
            const external = record[externalKey];
            const outpost = record[outpostKey];

            return (
                typeof external === 'string' &&
                // Non-blank: the loaders test truthiness, so '' would pass here
                // and then be discarded there.
                external.trim().length > 0 &&
                typeof outpost === 'string' &&
                validOutpostValues.includes(outpost)
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

    if (
        !isValidMappingShape(
            body.statusMappings,
            Object.values(TicketStatus),
            'externalStatus',
            'outpostStatus',
        )
    ) {
        return NextResponse.json(
            { error: 'statusMappings has invalid shape or unknown outpostStatus value' },
            { status: 400 },
        );
    }

    if (
        !isValidMappingShape(
            body.priorityMappings,
            Object.values(TicketPriority),
            'externalPriority',
            'outpostPriority',
        )
    ) {
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
