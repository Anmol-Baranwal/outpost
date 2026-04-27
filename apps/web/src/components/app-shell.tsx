'use client';

import { usePathname } from 'next/navigation';
import { Sidebar, MobileNav } from '@/components/sidebar';
import { KeyboardShortcutProvider } from '@/components/keyboard-shortcut-provider';

const PUBLIC_PATHS = ['/login', '/setup', '/invite'];

export function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

    if (isPublic) {
        return <>{children}</>;
    }

    return (
        <div className="flex h-screen">
            <Sidebar />
            <main className="flex-1 overflow-auto p-6 pb-20 md:pb-6">
                <KeyboardShortcutProvider />
                {children}
            </main>
            <MobileNav />
        </div>
    );
}
