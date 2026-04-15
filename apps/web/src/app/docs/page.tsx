import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

export default function DocsPage() {
    return (
        <div>
            <PageHeader
                title="Documentation"
                description="Knowledge base articles and documentation management."
                icon={FileText}
                breadcrumbs={[{ label: 'Docs' }]}
            />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className="rounded-lg border border-border bg-card p-6">
                    <h3 className="font-semibold text-card-foreground">Getting Started</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Quick start guides and tutorials</p>
                    <p className="mt-4 text-xs text-muted-foreground">0 articles</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-6">
                    <h3 className="font-semibold text-card-foreground">API Reference</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Complete API documentation</p>
                    <p className="mt-4 text-xs text-muted-foreground">0 articles</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-6">
                    <h3 className="font-semibold text-card-foreground">Guides</h3>
                    <p className="mt-1 text-sm text-muted-foreground">In-depth guides for common use cases</p>
                    <p className="mt-4 text-xs text-muted-foreground">0 articles</p>
                </div>
            </div>
        </div>
    );
}
