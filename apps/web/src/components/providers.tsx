'use client';

import { SessionProvider } from 'next-auth/react';
import { SidebarProvider } from '@/hooks/use-sidebar';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            <SidebarProvider>
                {children}
            </SidebarProvider>
        </SessionProvider>
    );
}
