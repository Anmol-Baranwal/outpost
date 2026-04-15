import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

export default function AccountsPage() {
    return (
        <div>
            <PageHeader
                title="Accounts"
                description="Manage customer accounts, sentiment, and engagement."
                icon={Building2}
                breadcrumbs={[{ label: 'Accounts' }]}
            />
            <div className="rounded-lg border border-border bg-card">
                <div className="border-b border-border px-6 py-4">
                    <div className="flex items-center justify-between">
                        <input
                            type="text"
                            placeholder="Search accounts..."
                            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
                        />
                        <button className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
                            Add Account
                        </button>
                    </div>
                </div>
                <div className="p-6 text-center text-sm text-muted-foreground">
                    Account list will be populated from the database.
                </div>
            </div>
        </div>
    );
}
