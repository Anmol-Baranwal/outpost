import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '@/components/sidebar';

// Mock next/navigation
const mockPathname = vi.fn().mockReturnValue('/dashboard');
vi.mock('next/navigation', () => ({
    usePathname: () => mockPathname(),
}));

// Mock next/link
vi.mock('next/link', () => ({
    default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
        <a href={href} {...props}>{children}</a>
    ),
}));

// Mock next-auth/react
vi.mock('next-auth/react', () => ({
    useSession: () => ({
        data: {
            user: { name: 'Test User', email: 'test@example.com', image: null },
        },
    }),
    signOut: vi.fn(),
    SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock sidebar context
vi.mock('@/hooks/use-sidebar', () => {
    let collapsed = false;
    return {
        useSidebar: () => ({
            collapsed,
            toggle: () => { collapsed = !collapsed; },
            setCollapsed: (val: boolean) => { collapsed = val; },
        }),
        SidebarProvider: ({ children }: { children: React.ReactNode }) => children,
    };
});

describe('Sidebar', () => {
    beforeEach(() => {
        mockPathname.mockReturnValue('/dashboard');
    });

    it('renders all navigation items', () => {
        render(<Sidebar />);

        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Accounts')).toBeInTheDocument();
        expect(screen.getByText('Tickets')).toBeInTheDocument();
        expect(screen.getByText('Docs')).toBeInTheDocument();
        expect(screen.getByText('Agents')).toBeInTheDocument();
        expect(screen.getByText('Broadcasts')).toBeInTheDocument();
    });

    it('renders the Outpost brand', () => {
        render(<Sidebar />);
        expect(screen.getByText('Outpost')).toBeInTheDocument();
    });

    it('renders settings and help links', () => {
        render(<Sidebar />);
        expect(screen.getByText('Settings')).toBeInTheDocument();
        expect(screen.getByText('Help')).toBeInTheDocument();
    });

    it('highlights the active nav item for /dashboard', () => {
        mockPathname.mockReturnValue('/dashboard');
        render(<Sidebar />);

        const dashboardLink = screen.getByText('Dashboard').closest('a');
        expect(dashboardLink?.className).toContain('font-semibold');
    });

    it('highlights the active nav item for /tickets', () => {
        mockPathname.mockReturnValue('/tickets');
        render(<Sidebar />);

        const ticketsLink = screen.getByText('Tickets').closest('a');
        expect(ticketsLink?.className).toContain('font-semibold');

        const dashboardLink = screen.getByText('Dashboard').closest('a');
        expect(dashboardLink?.className).not.toContain('font-semibold');
    });

    it('has a toggle button', () => {
        render(<Sidebar />);
        expect(screen.getByTestId('sidebar-toggle')).toBeInTheDocument();
    });

    it('renders the sidebar element', () => {
        render(<Sidebar />);
        expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });
});
