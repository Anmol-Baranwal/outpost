import { TicketsView } from '@/components/tickets/tickets-view';

interface TicketDetailPageProps {
    params: Promise<{ ticketId: string }>;
}

export default async function TicketDetailPage({ params }: TicketDetailPageProps) {
    const { ticketId } = await params;
    return <TicketsView ticketId={ticketId} />;
}
