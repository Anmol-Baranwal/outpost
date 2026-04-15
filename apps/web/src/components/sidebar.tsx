'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
    name: string;
    href: string;
    icon: string;
}

const navItems: NavItem[] = [
    { name: 'Dashboard', href: '/dashboard', icon: '📊' },
    { name: 'Accounts', href: '/accounts', icon: '🏢' },
    { name: 'Tickets', href: '/tickets', icon: '🎫' },
    { name: 'Docs', href: '/docs', icon: '📚' },
    { name: 'Agents', href: '/agents', icon: '🤖' },
    { name: 'Broadcasts', href: '/broadcasts', icon: '📢' },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="flex w-64 flex-col border-r border-gray-200 bg-sidebar">
            <div className="flex h-16 items-center border-b border-gray-200 px-6">
                <h1 className="text-xl font-bold text-gray-900">Outpost</h1>
            </div>
            <nav className="flex-1 space-y-1 p-4">
                {navItems.map((item) => {
                    const isActive = pathname.startsWith(item.href);
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                                isActive
                                    ? 'bg-sidebar-active text-sidebar-active-foreground'
                                    : 'text-sidebar-foreground hover:bg-sidebar-hover'
                            }`}
                        >
                            <span className="text-lg">{item.icon}</span>
                            {item.name}
                        </Link>
                    );
                })}
            </nav>
            <div className="border-t border-gray-200 p-4">
                <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-500">
                    <span className="text-lg">⚙️</span>
                    Settings
                </div>
            </div>
        </aside>
    );
}
