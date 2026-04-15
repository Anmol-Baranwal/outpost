import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { Sidebar, MobileNav } from '@/components/sidebar';
import { KeyboardShortcutProvider } from '@/components/keyboard-shortcut-provider';
import './globals.css';

export const metadata: Metadata = {
    title: 'Outpost - AI-Powered Support Operations',
    description: 'CopilotKit support operations platform',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" className="dark">
            <body className="antialiased">
                <Providers>
                    <div className="flex h-screen">
                        <Sidebar />
                        <main className="flex-1 overflow-auto p-6 pb-20 md:pb-6">
                            <KeyboardShortcutProvider />
                            {children}
                        </main>
                        <MobileNav />
                    </div>
                </Providers>
            </body>
        </html>
    );
}
