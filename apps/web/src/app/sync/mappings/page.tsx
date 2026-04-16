'use client';

import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { MappingEditor } from '@/components/sync/mapping-editor';
import type { MappingConfig } from '@/lib/mock-sync';

export default function MappingsPage() {
    const [config, setConfig] = useState<MappingConfig | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);

    useEffect(() => {
        async function fetchMappings() {
            try {
                const res = await fetch('/api/sync/mappings');
                const data = await res.json();
                setConfig(data);
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
            const res = await fetch('/api/sync/mappings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedConfig),
            });
            if (res.ok) {
                setConfig(updatedConfig);
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
                breadcrumbs={[
                    { label: 'Sync', href: '/sync' },
                    { label: 'Mappings' },
                ]}
            />

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
