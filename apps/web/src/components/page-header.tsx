import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Breadcrumb {
    label: string;
    href?: string;
}

interface PageHeaderProps {
    title: string;
    description?: string;
    icon?: LucideIcon;
    breadcrumbs?: Breadcrumb[];
}

export function PageHeader({ title, description, icon: Icon, breadcrumbs }: PageHeaderProps) {
    return (
        <div className="mb-8">
            {breadcrumbs && breadcrumbs.length > 0 && (
                <nav className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                    {breadcrumbs.map((crumb, i) => (
                        <span key={crumb.label} className="flex items-center gap-1.5">
                            {i > 0 && <span>/</span>}
                            {crumb.href ? (
                                <a
                                    href={crumb.href}
                                    className="hover:text-foreground transition-colors"
                                >
                                    {crumb.label}
                                </a>
                            ) : (
                                <span className="text-foreground">{crumb.label}</span>
                            )}
                        </span>
                    ))}
                </nav>
            )}
            <div className="flex items-center gap-3">
                {Icon && (
                    <div className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-lg',
                        'bg-primary/10 text-primary'
                    )}>
                        <Icon className="h-5 w-5" />
                    </div>
                )}
                <div>
                    <h1 className="text-2xl font-bold text-foreground">{title}</h1>
                    {description && (
                        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
