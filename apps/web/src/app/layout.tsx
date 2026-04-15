import type { Metadata } from 'next';
import { Sidebar } from '@/components/sidebar';
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
        <html lang="en">
            <body className="antialiased">
                <div className="flex h-screen">
                    <Sidebar />
                    <main className="flex-1 overflow-auto p-8">
                        {children}
                    </main>
                </div>
            </body>
        </html>
    );
}
