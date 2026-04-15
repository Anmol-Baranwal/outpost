'use client';

import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import React from 'react';

interface SidebarState {
    collapsed: boolean;
    toggle: () => void;
    setCollapsed: (value: boolean) => void;
}

const SidebarContext = createContext<SidebarState>({
    collapsed: false,
    toggle: () => {},
    setCollapsed: () => {},
});

export function SidebarProvider({ children }: { children: ReactNode }) {
    const [collapsed, setCollapsed] = useState(false);

    const toggle = useCallback(() => {
        setCollapsed((prev) => !prev);
    }, []);

    return React.createElement(
        SidebarContext.Provider,
        { value: { collapsed, toggle, setCollapsed } },
        children,
    );
}

export function useSidebar(): SidebarState {
    return useContext(SidebarContext);
}
