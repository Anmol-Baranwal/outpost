/**
 * Types for the Outpost AI pipeline.
 */

export enum ConfidenceLevel {
    HIGH = 'HIGH',
    MEDIUM = 'MEDIUM',
    LOW = 'LOW',
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
    /** Filter by category */
    category?: string;
}
