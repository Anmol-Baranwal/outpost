'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { User, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UserMenuProps {
    collapsed: boolean;
}

export function UserMenu({ collapsed }: UserMenuProps) {
    const { data: session } = useSession();
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!session?.user) {
        return null;
    }

    const avatar = session.user.image;
    const name = session.user.name ?? 'User';
    const email = session.user.email ?? '';

    return (
        <div ref={menuRef} className="relative" data-testid="user-menu">
            <button
                onClick={() => setOpen(!open)}
                className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-hover transition-colors',
                    collapsed && 'justify-center px-0'
                )}
            >
                {avatar ? (
                    <img
                        src={avatar}
                        alt={name}
                        className="h-6 w-6 rounded-full shrink-0"
                    />
                ) : (
                    <User className="h-5 w-5 shrink-0" />
                )}
                {!collapsed && (
                    <span className="truncate">{name}</span>
                )}
            </button>

            {open && (
                <div
                    data-testid="user-menu-dropdown"
                    className="absolute bottom-full left-0 mb-2 w-56 rounded-lg border border-border bg-popover p-1 shadow-lg"
                >
                    <div className="px-3 py-2 border-b border-border">
                        <p className="text-sm font-medium text-popover-foreground">{name}</p>
                        <p className="text-xs text-muted-foreground truncate">{email}</p>
                    </div>
                    <button
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-popover-foreground hover:bg-accent transition-colors"
                    >
                        <User className="h-4 w-4" />
                        Profile
                    </button>
                    <button
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-popover-foreground hover:bg-accent transition-colors"
                    >
                        <Settings className="h-4 w-4" />
                        Settings
                    </button>
                    <div className="border-t border-border mt-1 pt-1">
                        <button
                            data-testid="sign-out-button"
                            onClick={() => signOut({ callbackUrl: '/login' })}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-accent transition-colors"
                        >
                            <LogOut className="h-4 w-4" />
                            Sign out
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
