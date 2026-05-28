'use client';

import { usePathname } from 'next/navigation';
import { Sidebar, MobileNav } from '@/components/sidebar';
import { KeyboardShortcutProvider } from '@/components/keyboard-shortcut-provider';
import { cn } from '@/lib/utils';

const PUBLIC_PATHS = ['/login', '/setup', '/invite'];

// Routes that manage their own padding and want to fill the full main area.
const FULLBLEED_PATHS = ['/tickets'];

export function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
    const isFullBleed = FULLBLEED_PATHS.some((p) => pathname.startsWith(p));

    if (isPublic) {
        return <>{children}</>;
    }

    return (
        <div className="flex h-screen">
            <Sidebar />
            <main
                className={cn(
                    'flex-1 min-w-0',
                    isFullBleed
                        ? 'overflow-hidden pb-14 md:pb-0'
                        : 'overflow-auto p-6 pb-20 md:pb-6',
                )}
            >
                <KeyboardShortcutProvider />
                {children}
            </main>
            <MobileNav />
        </div>
    );
}
