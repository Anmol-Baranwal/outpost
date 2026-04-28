'use client';

import { useEffect, useState } from 'react';
import { type PendingMessage } from '@copilotkit/outpost/shared';
import { MessageInbox } from '@/components/messaging/message-inbox';

export default function MessagingPage() {
    const [messages, setMessages] = useState<PendingMessage[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchMessages() {
            try {
                const res = await fetch('/api/messaging/pending');
                if (!res.ok) return;
                const data = await res.json();
                setMessages(data.messages ?? []);
            } catch {
            } finally {
                setLoading(false);
            }
        }

        fetchMessages();
    }, []);

    return <MessageInbox messages={messages} loading={loading} />;
}
