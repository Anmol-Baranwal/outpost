/**
 * Label mapping between external labels and Outpost tags.
 *
 * Handles prefix stripping (external → Outpost) and prefix
 * adding (Outpost → external). Configurable per plugin.
 */

// ─── Types ────────────────────────────────────────────────────────────────

/** Rule for stripping/adding a prefix on a label group. */
export interface LabelPrefixRule {
    /** The external prefix to strip, including separator (e.g. "priority:", "type/"). */
    externalPrefix: string;
    /** The Outpost prefix to add when pushing back, including separator. Empty string = no prefix. */
    outpostPrefix: string;
}

export interface LabelMapperConfig {
    /** Prefix rules applied in order. First matching rule wins. */
    rules: LabelPrefixRule[];
    /** Labels to exclude entirely (case-insensitive). */
    exclude?: string[];
}

// ─── LabelMapper ──────────────────────────────────────────────────────────

export class LabelMapper {
    private readonly rules: LabelPrefixRule[];
    private readonly excludeSet: Set<string>;

    constructor(config: LabelMapperConfig) {
        this.rules = config.rules;
        this.excludeSet = new Set((config.exclude ?? []).map((l) => l.toLowerCase()));
    }

    /**
     * The labels this mapper excludes, lowercased.
     *
     * Exposed so a mapper rebuilt from persisted config can inherit the factory's
     * exclusions instead of silently dropping them.
     */
    getExcludeList(): string[] {
        return [...this.excludeSet];
    }

    /**
     * Convert external labels to Outpost tags.
     * Strips matching prefixes and excludes blacklisted labels.
     */
    toOutpost(externalLabels: string[]): string[] {
        const tags: string[] = [];

        for (const label of externalLabels) {
            if (this.excludeSet.has(label.toLowerCase())) {
                continue;
            }

            let tag = label;
            for (const rule of this.rules) {
                if (label.toLowerCase().startsWith(rule.externalPrefix.toLowerCase())) {
                    tag = label.slice(rule.externalPrefix.length);
                    break;
                }
            }

            if (tag.length > 0) {
                tags.push(tag);
            }
        }

        return tags;
    }

    /**
     * Convert Outpost tags back to external labels.
     * Adds matching prefixes based on rules.
     */
    fromOutpost(outpostTags: string[]): string[] {
        const labels: string[] = [];

        for (const tag of outpostTags) {
            let label = tag;

            // Find a rule whose outpostPrefix matches (or use the rule
            // whose stripped result would produce this tag).
            for (const rule of this.rules) {
                if (
                    rule.outpostPrefix.length > 0 &&
                    tag.toLowerCase().startsWith(rule.outpostPrefix.toLowerCase())
                ) {
                    // Tag already has the Outpost prefix — swap to external.
                    const stripped = tag.slice(rule.outpostPrefix.length);
                    label = rule.externalPrefix + stripped;
                    break;
                }
            }

            labels.push(label);
        }

        return labels;
    }

    /**
     * Round-trip helper: convert Outpost tags to external labels
     * using explicit tag→prefix association.
     *
     * Each tag is paired with the rule index (or -1 for no rule)
     * that produced it during toOutpost, enabling a lossless
     * round-trip.  When the producing rule is unknown, this falls
     * back to returning the tag unmodified.
     */
    toExternal(tag: string, ruleIndex: number): string {
        if (ruleIndex >= 0 && ruleIndex < this.rules.length) {
            return this.rules[ruleIndex].externalPrefix + tag;
        }
        return tag;
    }
}

// ─── Factory Functions ────────────────────────────────────────────────────

/** GitHub label conventions → Outpost tags. */
export function createGitHubLabelMapper(): LabelMapper {
    return new LabelMapper({
        rules: [
            { externalPrefix: 'priority:', outpostPrefix: '' },
            { externalPrefix: 'type:', outpostPrefix: '' },
            { externalPrefix: 'area/', outpostPrefix: '' },
        ],
        exclude: ['wontfix', 'duplicate', 'invalid'],
    });
}

/** Linear label conventions → Outpost tags. */
export function createLinearLabelMapper(): LabelMapper {
    return new LabelMapper({
        rules: [
            { externalPrefix: 'Priority: ', outpostPrefix: '' },
            { externalPrefix: 'Type: ', outpostPrefix: '' },
        ],
    });
}

// ─── Persisted Config Loading ─────────────────────────────────────────────

/** Must match the key used by apps/web/src/app/api/sync/mappings/route.ts. */
const MAPPING_CONFIG_KEY = 'sync.mappingConfig';

/** Minimal Prisma subset needed to load a persisted mapping config. */
export interface LabelMapperDb {
    systemConfig: {
        findUnique(args: {
            where: { key: string };
        }): Promise<{ key: string; value: string } | null>;
    };
}

interface PersistedLabelRuleEntry {
    externalPrefix: string;
    outpostPrefix: string;
}

/**
 * Build a LabelMapper for `plugin`, preferring the persisted SystemConfig
 * row (written by the /api/sync/mappings dashboard) over the hardcoded
 * factory defaults. Falls back to the hardcoded default whenever the
 * config row is missing, malformed, or has no rules for this plugin.
 *
 * Mirrors loadStatusMap in status-map.ts. Note the persisted labelRules
 * carry only prefix rules (externalPrefix/outpostPrefix); the `exclude`
 * list is not dashboard-editable, so a persisted config produces a mapper
 * with no exclusions.
 */
export async function loadLabelMapper(
    plugin: 'linear' | 'github',
    db: LabelMapperDb,
): Promise<LabelMapper> {
    const fallback = plugin === 'linear' ? createLinearLabelMapper() : createGitHubLabelMapper();

    const row = await db.systemConfig.findUnique({ where: { key: MAPPING_CONFIG_KEY } });
    if (!row) return fallback;

    let parsed: unknown;
    try {
        parsed = JSON.parse(row.value);
    } catch {
        return fallback;
    }

    const entries = (parsed as { labelRules?: Record<string, PersistedLabelRuleEntry[]> })
        ?.labelRules?.[plugin];
    if (!Array.isArray(entries) || entries.length === 0) return fallback;

    const rules: LabelPrefixRule[] = [];
    for (const entry of entries) {
        if (typeof entry?.externalPrefix === 'string' && typeof entry?.outpostPrefix === 'string') {
            rules.push({
                externalPrefix: entry.externalPrefix,
                outpostPrefix: entry.outpostPrefix,
            });
        }
    }
    if (rules.length === 0) return fallback;

    // Carry the factory's `exclude` list across. Persisting only `rules` meant the
    // first save silently dropped GitHub's wontfix/duplicate/invalid exclusions —
    // the operator changed a prefix and lost label filtering with nothing logged.
    // The persisted shape has no `exclude` field yet, so the factory default is
    // the authority; when it gains one, prefer the persisted value here.
    return new LabelMapper({ rules, exclude: fallback.getExcludeList() });
}
