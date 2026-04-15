import Link from 'next/link';
import { MapPin } from 'lucide-react';

export default function NotFound() {
    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <MapPin className="h-8 w-8 text-muted-foreground" />
            </div>
            <h1 className="mt-6 text-2xl font-bold text-foreground">Page not found</h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
                The page you are looking for does not exist or has been moved.
            </p>
            <Link
                href="/dashboard"
                className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
            >
                Back to Dashboard
            </Link>
        </div>
    );
}
