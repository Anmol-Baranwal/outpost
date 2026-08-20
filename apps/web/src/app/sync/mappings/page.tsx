'use client';

import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { MappingEditor } from '@/components/sync/mapping-editor';
import type { MappingConfig } from '@/lib/mock-sync';
import { apiFetch } from '@/lib/api-fetch';

/** Provenance the mappings API reports alongside the config it serves. */
interface ConfigProvenance {
    configSource?: 'persisted' | 'defaults';
    configError?: string;
    invalidSections?: string[];
}

export default function MappingsPage() {
    const [config, setConfig] = useState<MappingConfig | null>(null);
    const [provenance, setProvenance] = useState<ConfigProvenance>({});
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);

    useEffect(() => {
        async function fetchMappings() {
            try {
                const res = await apiFetch('/api/sync/mappings');
                const data = await res.json();
                setConfig(data);
                setProvenance({
                    configSource: data.configSource,
                    configError: data.configError,
                    invalidSections: data.invalidSections,
                });
            } catch {
                // noop
            }
        }
        fetchMappings();
    }, []);

    async function handleSave(updatedConfig: MappingConfig) {
        setSaving(true);
        setSaveMessage(null);
        try {
            const res = await apiFetch('/api/sync/mappings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedConfig),
            });
            if (res.ok) {
                // Store what the server persisted, not what was sent. A PUT that omits
                // labelRules has them carried forward server-side, so echoing the request
                // body back into state would drop rules that are actually saved — they
                // would vanish from the editor until the next page load.
                const saved = (await res.json().catch(() => null)) as MappingConfig | null;
                setConfig(saved ?? updatedConfig);
                // A successful PUT means a saved configuration is now in effect, so the
                // "no saved mapping configuration" / "using built-in defaults for …"
                // notices no longer describe reality. Without this they sit on screen
                // next to "Mappings saved successfully", contradicting it.
                setProvenance({});
                setSaveMessage('Mappings saved successfully.');
            } else {
                setSaveMessage('Failed to save mappings.');
            }
        } catch {
            setSaveMessage('Failed to save mappings.');
        } finally {
            setSaving(false);
            setTimeout(() => setSaveMessage(null), 3000);
        }
    }

    return (
        <div>
            <PageHeader
                title="Mapping Configuration"
                description="Configure how statuses, priorities, identities, and labels map between systems."
                icon={Settings2}
                breadcrumbs={[{ label: 'Sync', href: '/sync' }, { label: 'Mappings' }]}
            />

            {/*
             * Say when what is on screen is NOT the saved configuration. The API
             * reports this, and without surfacing it the page renders code
             * defaults identically to persisted settings — so an admin whose row
             * is unusable sees no difference and re-saves the defaults over it.
             */}
            {provenance.configSource === 'defaults' && (
                <div
                    data-testid="config-defaults-notice"
                    className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-foreground"
                >
                    Showing built-in defaults — no saved mapping configuration is in effect.
                    {provenance.configError ? ` (${provenance.configError})` : ''}
                </div>
            )}

            {provenance.invalidSections && provenance.invalidSections.length > 0 && (
                <div
                    data-testid="config-invalid-sections-notice"
                    className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-foreground"
                >
                    Using built-in defaults for {provenance.invalidSections.join(', ')} — the saved
                    values could not be read. Saving will overwrite them.
                </div>
            )}

            {saveMessage && (
                <div
                    data-testid="save-message"
                    className="mb-4 rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground"
                >
                    {saveMessage}
                </div>
            )}

            {config ? (
                <MappingEditor config={config} onSave={handleSave} />
            ) : (
                <div className="text-sm text-muted-foreground">Loading mappings...</div>
            )}
        </div>
    );
}
