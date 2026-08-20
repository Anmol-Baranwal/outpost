'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ArrowRight, Save, Link2, Settings2 } from 'lucide-react';
import type {
    MappingConfig,
    StatusMappingEntry,
    PriorityMappingEntry,
    IdentityMappingEntry,
    LabelMappingRule,
} from '@/lib/mock-sync';

const OUTPOST_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'WAITING_ON_TEAM', 'RESOLVED', 'CLOSED'];
const OUTPOST_PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

interface MappingEditorProps {
    config: MappingConfig;
    onSave: (config: MappingConfig) => void;
}

export function MappingEditor({ config, onSave }: MappingEditorProps) {
    const [activeTab, setActiveTab] = useState<'status' | 'priority' | 'identity' | 'labels'>('status');
    const [localConfig, setLocalConfig] = useState(config);
    const [dirty, setDirty] = useState(false);

    function updateStatusMapping(plugin: string, index: number, outpostStatus: string) {
        const next = { ...localConfig };
        next.statusMappings = { ...next.statusMappings };
        next.statusMappings[plugin] = [...next.statusMappings[plugin]];
        next.statusMappings[plugin][index] = {
            ...next.statusMappings[plugin][index],
            outpostStatus,
        };
        setLocalConfig(next);
        setDirty(true);
    }

    function updatePriorityMapping(plugin: string, index: number, outpostPriority: string) {
        const next = { ...localConfig };
        next.priorityMappings = { ...next.priorityMappings };
        next.priorityMappings[plugin] = [...next.priorityMappings[plugin]];
        next.priorityMappings[plugin][index] = {
            ...next.priorityMappings[plugin][index],
            outpostPriority,
        };
        setLocalConfig(next);
        setDirty(true);
    }

    function handleSave() {
        onSave(localConfig);
        setDirty(false);
    }

    const tabs = [
        { id: 'status' as const, label: 'Status Mapping' },
        { id: 'priority' as const, label: 'Priority Mapping' },
        { id: 'identity' as const, label: 'Identity Mapping' },
        { id: 'labels' as const, label: 'Label Rules' },
    ];

    return (
        <div data-testid="mapping-editor" className="rounded-xl border border-border bg-card">
            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-border px-5 py-2">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        data-testid={`mapping-tab-${tab.id}`}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                            activeTab === tab.id
                                ? 'bg-primary/15 text-primary'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
                {dirty && (
                    <button
                        data-testid="mapping-save"
                        onClick={handleSave}
                        className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                        <Save className="h-3.5 w-3.5" />
                        Save Changes
                    </button>
                )}
            </div>

            {/* Content */}
            <div className="p-5">
                {activeTab === 'status' && (
                    <StatusMappingPanel
                        mappings={localConfig.statusMappings}
                        onChange={updateStatusMapping}
                    />
                )}
                {activeTab === 'priority' && (
                    <PriorityMappingPanel
                        mappings={localConfig.priorityMappings}
                        onChange={updatePriorityMapping}
                    />
                )}
                {activeTab === 'identity' && (
                    <IdentityMappingPanel mappings={localConfig.identityMappings} />
                )}
                {activeTab === 'labels' && (
                    <LabelRulesPanel rules={localConfig.labelRules} />
                )}
            </div>
        </div>
    );
}

// ─── Sub-panels ───────────────────────────────────────────────────────────

function StatusMappingPanel({
    mappings,
    onChange,
}: {
    mappings: Record<string, StatusMappingEntry[]>;
    onChange: (plugin: string, index: number, outpostStatus: string) => void;
}) {
    return (
        <div className="space-y-6" data-testid="status-mapping-panel">
            {Object.entries(mappings).map(([plugin, entries]) => (
                <div key={plugin}>
                    <h3 className="text-sm font-semibold text-foreground capitalize mb-3 flex items-center gap-2">
                        <Settings2 className="h-4 w-4 text-muted-foreground" />
                        {plugin}
                    </h3>
                    <div className="space-y-2">
                        {entries.map((entry, i) => (
                            <div
                                key={entry.externalStatus}
                                data-testid={`status-row-${plugin}-${i}`}
                                className="flex items-center gap-3"
                            >
                                <span className="w-32 text-sm text-muted-foreground font-mono">
                                    {entry.externalStatus}
                                </span>
                                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <select
                                    data-testid={`status-select-${plugin}-${i}`}
                                    value={entry.outpostStatus}
                                    onChange={(e) => onChange(plugin, i, e.target.value)}
                                    className="rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground"
                                >
                                    {OUTPOST_STATUSES.map((s) => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function PriorityMappingPanel({
    mappings,
    onChange,
}: {
    mappings: Record<string, PriorityMappingEntry[]>;
    onChange: (plugin: string, index: number, outpostPriority: string) => void;
}) {
    return (
        <div className="space-y-6" data-testid="priority-mapping-panel">
            {Object.entries(mappings).map(([plugin, entries]) => (
                <div key={plugin}>
                    <h3 className="text-sm font-semibold text-foreground capitalize mb-3 flex items-center gap-2">
                        <Settings2 className="h-4 w-4 text-muted-foreground" />
                        {plugin}
                    </h3>
                    <div className="space-y-2">
                        {entries.map((entry, i) => (
                            <div
                                key={entry.externalPriority}
                                data-testid={`priority-row-${plugin}-${i}`}
                                className="flex items-center gap-3"
                            >
                                <span className="w-32 text-sm text-muted-foreground">
                                    {entry.label ? (
                                        <>
                                            {entry.label}{' '}
                                            <span className="font-mono text-xs opacity-60">
                                                ({entry.externalPriority})
                                            </span>
                                        </>
                                    ) : (
                                        <span className="font-mono">{entry.externalPriority}</span>
                                    )}
                                </span>
                                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <select
                                    data-testid={`priority-select-${plugin}-${i}`}
                                    value={entry.outpostPriority}
                                    onChange={(e) => onChange(plugin, i, e.target.value)}
                                    className="rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground"
                                >
                                    {OUTPOST_PRIORITIES.map((p) => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function IdentityMappingPanel({ mappings }: { mappings: IdentityMappingEntry[] }) {
    return (
        <div data-testid="identity-mapping-panel">
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                            <th className="py-2 text-left font-medium">Plugin</th>
                            <th className="py-2 text-left font-medium">External User</th>
                            <th className="py-2 text-left font-medium">Team Member</th>
                            <th className="py-2 text-left font-medium">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {mappings.map((mapping) => (
                            <tr key={mapping.id} data-testid={`identity-row-${mapping.id}`}>
                                <td className="py-2 capitalize text-foreground">{mapping.externalPlugin}</td>
                                <td className="py-2 text-muted-foreground">{mapping.externalDisplayName}</td>
                                <td className="py-2 text-foreground">
                                    {mapping.memberName ?? (
                                        <span className="text-amber-400 text-xs">Unlinked</span>
                                    )}
                                </td>
                                <td className="py-2">
                                    {!mapping.memberId && (
                                        <button
                                            data-testid={`link-identity-${mapping.id}`}
                                            className="flex items-center gap-1 rounded-lg bg-primary/15 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/25 transition-colors"
                                        >
                                            <Link2 className="h-3 w-3" />
                                            Link
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function LabelRulesPanel({ rules }: { rules: Record<string, LabelMappingRule[]> }) {
    return (
        <div className="space-y-6" data-testid="label-rules-panel">
            {Object.entries(rules).map(([plugin, ruleList]) => (
                <div key={plugin}>
                    <h3 className="text-sm font-semibold text-foreground capitalize mb-3 flex items-center gap-2">
                        <Settings2 className="h-4 w-4 text-muted-foreground" />
                        {plugin}
                    </h3>
                    <div className="space-y-2">
                        {ruleList.map((rule, i) => (
                            <div
                                key={i}
                                data-testid={`label-rule-${plugin}-${i}`}
                                className="flex items-center gap-3 text-sm"
                            >
                                <span className="text-muted-foreground font-mono">
                                    {rule.externalPrefix || '(none)'}
                                </span>
                                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="text-foreground font-mono">
                                    {rule.outpostPrefix || '(strip prefix)'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
