import { PageHeader } from '@/components/page-header';

export default function AccountsPage() {
    return (
        <div>
            <PageHeader
                title="Accounts"
                description="Manage customer accounts, sentiment, and engagement."
            />
            <div className="rounded-lg border border-gray-200">
                <div className="border-b border-gray-200 px-6 py-4">
                    <div className="flex items-center justify-between">
                        <input
                            type="text"
                            placeholder="Search accounts..."
                            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                        />
                        <button className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                            Add Account
                        </button>
                    </div>
                </div>
                <div className="p-6 text-center text-sm text-gray-500">
                    Account list will be populated from the database.
                </div>
            </div>
        </div>
    );
}
