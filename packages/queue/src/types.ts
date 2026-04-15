/**
 * Job queue types for the Postgres-based job queue.
 */

export enum JobType {
    /** Process an incoming ticket from any source */
    PROCESS_TICKET = 'PROCESS_TICKET',
    /** Generate an AI response for a ticket */
    GENERATE_RESPONSE = 'GENERATE_RESPONSE',
    /** Send a notification (Discord, email, etc.) */
    SEND_NOTIFICATION = 'SEND_NOTIFICATION',
    /** Check SLA compliance for all open tickets */
    CHECK_SLA = 'CHECK_SLA',
    /** Analyze sentiment for a batch of messages */
    ANALYZE_SENTIMENT = 'ANALYZE_SENTIMENT',
    /** Sync documentation from external sources */
    SYNC_DOCS = 'SYNC_DOCS',
    /** Send a broadcast message */
    SEND_BROADCAST = 'SEND_BROADCAST',
    /** Index content for search */
    INDEX_CONTENT = 'INDEX_CONTENT',
}

export interface JobPayload {
    [JobType.PROCESS_TICKET]: {
        ticketId: string;
        source: string;
        sourceData: Record<string, unknown>;
    };
    [JobType.GENERATE_RESPONSE]: {
        ticketId: string;
        messageId: string;
        context: string;
    };
    [JobType.SEND_NOTIFICATION]: {
        channel: 'discord' | 'email' | 'web';
        recipient: string;
        subject?: string;
        body: string;
        metadata?: Record<string, unknown>;
    };
    [JobType.CHECK_SLA]: {
        batchSize?: number;
    };
    [JobType.ANALYZE_SENTIMENT]: {
        accountId: string;
        messageIds: string[];
    };
    [JobType.SYNC_DOCS]: {
        sourceUrl: string;
        categoryId: string;
    };
    [JobType.SEND_BROADCAST]: {
        broadcastId: string;
    };
    [JobType.INDEX_CONTENT]: {
        contentType: 'doc' | 'ticket' | 'message';
        contentId: string;
    };
}

export interface JobResult {
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
}

export interface CreateJobOptions {
    /** When to run the job (defaults to now) */
    runAt?: Date;
    /** Maximum retry attempts (defaults to MAX_JOB_ATTEMPTS) */
    maxAttempts?: number;
}

export type JobHandler<T extends JobType> = (payload: JobPayload[T]) => Promise<JobResult>;
