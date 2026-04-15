import { Suspense } from 'react';
import BroadcastsContent from './broadcasts-content';

export default function BroadcastsPage() {
    return (
        <Suspense fallback={<div className="p-6 text-muted-foreground">Loading broadcasts...</div>}>
            <BroadcastsContent />
        </Suspense>
    );
}
