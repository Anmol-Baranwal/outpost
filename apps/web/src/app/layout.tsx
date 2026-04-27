import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { AppShell } from '@/components/app-shell';
import './globals.css';

export const metadata: Metadata = {
    title: 'Outpost - AI-Powered Support Operations',
    description: 'AI-powered support operations platform by CopilotKit',
    icons: {
        icon: '/favicon.svg',
    },
    openGraph: {
        title: 'Outpost - AI-Powered Support Operations',
        description: 'AI-powered support operations platform by CopilotKit',
        images: [{ url: '/og-image.svg', width: 1200, height: 630, type: 'image/svg+xml' }],
    },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className="dark">
            <body className="antialiased">
                <Providers>
                    <AppShell>{children}</AppShell>
                </Providers>
            </body>
        </html>
    );
}
