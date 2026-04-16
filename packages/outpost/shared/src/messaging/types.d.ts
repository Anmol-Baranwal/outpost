/**
 * Types for the customer messaging system.
 * Covers Slack Connect and MS Teams channels.
 */
export declare enum MessageSource {
    SLACK = "SLACK",
    TEAMS = "TEAMS"
}
export declare enum UrgencyLevel {
    LOW = "LOW",// < 1 hour unanswered
    MEDIUM = "MEDIUM",// 1-4 hours unanswered
    HIGH = "HIGH"
}
export declare enum MessageStatus {
    UNANSWERED = "UNANSWERED",
    ANSWERED = "ANSWERED"
}
export interface PendingMessage {
    id: string;
    customerName: string;
    accountId: string;
    accountName: string;
    accountAcv: number;
    source: MessageSource;
    channelName: string;
    messagePreview: string;
    receivedAt: string;
    status: MessageStatus;
    answeredAt?: string;
}
export interface MessagingStats {
    totalPending: number;
    overdueCount: number;
    slackCount: number;
    teamsCount: number;
    avgResponseTimeMs: number;
}
export type MessageSortKey = 'recent' | 'oldest_unanswered' | 'acv';
export interface MessageFilters {
    source?: MessageSource;
    status?: MessageStatus;
    accountId?: string;
}
//# sourceMappingURL=types.d.ts.map