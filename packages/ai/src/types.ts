/**
 * Types for the Outpost AI pipeline.
 */

export enum ConfidenceLevel {
    HIGH = 'HIGH',
    MEDIUM = 'MEDIUM',
    LOW = 'LOW',
}

export enum TicketPriority {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
}

export enum TicketType {
    ISSUE = 'ISSUE',
    REQUEST = 'REQUEST',
}

export interface SearchResult {
    /** Title of the matched document or section */
    title: string;
    /** The matched content snippet */
    content: string;
    /** Relevance score from 0 to 1 */
    score: number;
    /** Source URL if available */
    sourceUrl?: string;
    /** Category of the matched content */
    category?: string;
}

export interface GeneratedResponse {
    /** The generated response text */
    text: string;
    /** Confidence score from 0 to 1 */
    confidence: number;
    /** Classified confidence level */
    confidenceLevel: ConfidenceLevel;
    /** Search results used as context for generation */
    sources: SearchResult[];
    /** Whether this response should be auto-sent */
    autoSend: boolean;
    /** Reasoning for the confidence assessment */
    reasoning: string;
    /** Token usage for cost monitoring */
    tokenUsage?: TokenUsage;
    /** End-to-end latency in milliseconds */
    latencyMs?: number;
}

export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
}

export interface PipelineContext {
    /** The user's question or message */
    question: string;
    /** Additional context (ticket history, account info, etc.) */
    context?: string;
    /** The ticket ID this response is for */
    ticketId?: string;
    /** The account domain for targeted search */
    accountDomain?: string;
}

export interface PathfinderQuery {
    /** The search query */
    query: string;
    /** Maximum number of results */
    limit?: number;
    /** Minimum relevance score threshold */
    minScore?: number;
    /** Filter by category */
    category?: string;
}

export interface TicketClassification {
    priority: TicketPriority;
    type: TicketType;
    tags: string[];
    reasoning: string;
}

export type PlatformTarget = 'discord' | 'github' | 'web';

export interface PipelineOptions {
    /** Platform target for response formatting */
    source: PlatformTarget;
    /** Whether to use streaming mode */
    streaming?: boolean;
    /** Conversation history for follow-up questions */
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    /** Maximum output tokens */
    maxTokens?: number;
}

export interface FormattedResponse {
    /** The formatted response text */
    text: string;
    /** Action buttons metadata (for Discord bot) */
    buttons?: Array<{ label: string; action: string }>;
    /** Whether the response was truncated */
    truncated?: boolean;
    /** Split messages (for Discord 2000-char limit) */
    parts?: string[];
}

export interface PipelineResult {
    /** The generated response text */
    response: string;
    /** Formatted response for the target platform */
    formatted: FormattedResponse;
    /** Confidence assessment */
    confidence: ConfidenceLevel;
    /** Confidence score (0-1) */
    confidenceScore: number;
    /** Search results used as context */
    searchResults: SearchResult[];
    /** Token usage across all Claude calls */
    tokenUsage: TokenUsage;
    /** End-to-end latency in milliseconds */
    latencyMs: number;
}
