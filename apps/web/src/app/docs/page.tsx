import { PageHeader } from '@/components/page-header';

export default function DocsPage() {
    return (
        <div>
            <PageHeader
                title="Documentation"
                description="Knowledge base articles and documentation management."
            />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className="rounded-lg border border-gray-200 p-6">
                    <h3 className="font-semibold text-gray-900">Getting Started</h3>
                    <p className="mt-1 text-sm text-gray-500">Quick start guides and tutorials</p>
                    <p className="mt-4 text-xs text-gray-400">0 articles</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-6">
                    <h3 className="font-semibold text-gray-900">API Reference</h3>
                    <p className="mt-1 text-sm text-gray-500">Complete API documentation</p>
                    <p className="mt-4 text-xs text-gray-400">0 articles</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-6">
                    <h3 className="font-semibold text-gray-900">Guides</h3>
                    <p className="mt-1 text-sm text-gray-500">In-depth guides for common use cases</p>
                    <p className="mt-4 text-xs text-gray-400">0 articles</p>
                </div>
            </div>
        </div>
    );
}
