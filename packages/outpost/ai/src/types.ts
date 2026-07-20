/**
 * Types for the Outpost AI pipeline.
 */

import { AI_CONFIDENCE, TicketPriority, TicketType } from '@copilotkit/outpost/shared';
import type { PlatformTarget } from '@copilotkit/outpost/shared';
export { TicketPriority, TicketType } from '@copilotkit/outpost/shared';
export type { PlatformTarget } from '@copilotkit/outpost/shared';

export enum ConfidenceLevel {
    HIGH = 'HIGH',
    MEDIUM = 'MEDIUM',
    LOW = 'LOW',
}

/**
 * Classify a numeric confidence score into a ConfidenceLevel.
 * Single source of truth — used by generator, pipeline, and confidence scorer.
 */
export function classifyConfidence(score: number): ConfidenceLevel {
    if (score >= AI_CONFIDENCE.HIGH_THRESHOLD) return ConfidenceLevel.HIGH;
    if (score >= AI_CONFIDENCE.MEDIUM_THRESHOLD) return ConfidenceLevel.MEDIUM;
    return ConfidenceLevel.LOW;
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
    confidenceScore: number;
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
    /**
     * The channel the question was asked in. Used so the generated response
     * never redirects the user to the channel they're already using
     * (e.g. "join the Discord" to someone already in Discord).
     */
    source?: PlatformTarget;
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

// ─── Sentiment Types ───────────────────────────────────────────────────────

export enum SentimentLabel {
    POSITIVE = 'POSITIVE',
    NEUTRAL = 'NEUTRAL',
    NEGATIVE = 'NEGATIVE',
    CRITICAL = 'CRITICAL',
}

export interface SentimentResult {
    /** Percentage of negative sentiment (0-100) */
    score: number;
    /** Classified sentiment label */
    label: SentimentLabel;
    /** Token usage for cost monitoring */
    tokenUsage: TokenUsage;
}

// ─── Engagement Types ──────────────────────────────────────────────────────

export enum EngagementLevel {
    HIGH = 'HIGH',
    MEDIUM = 'MEDIUM',
    LOW = 'LOW',
    INACTIVE = 'INACTIVE',
}

export interface AccountMetrics {
    /** Number of messages in the scoring window */
    messageCount: number;
    /** Number of tickets created in the scoring window */
    ticketCount: number;
    /** Average messages per day in the scoring window */
    avgMessagesPerDay: number;
    /** Days since most recent activity */
    daysSinceLastActivity: number;
    /** Percentage of messages that received a reply (0-100) */
    responseRate: number;
    /** Trend in ticket volume: positive = increasing, negative = decreasing */
    ticketVolumeTrend: number;
}

export interface EngagementResult {
    /** Engagement score (0-100) */
    score: number;
    /** Classified engagement level */
    level: EngagementLevel;
}

// ─── Sentiment Trend Types ─────────────────────────────────────────────────

export interface SentimentPeriod {
    /** Start of the period (ISO date string) */
    periodStart: string;
    /** End of the period (ISO date string) */
    periodEnd: string;
    /** Sentiment score for this period */
    score: number;
    /** Sentiment label for this period */
    label: SentimentLabel;
    /** Number of messages analyzed in this period */
    messageCount: number;
}

export interface SentimentTrendResult {
    /** Sentiment over each period */
    periods: SentimentPeriod[];
    /** Overall trend direction: 'IMPROVING' | 'STABLE' | 'DECLINING' */
    trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
    /** Change in score from first to last period (negative = improving, positive = worsening) */
    delta: number;
}

export interface PipelineOptions {
    /** Platform target for response formatting */
    source: PlatformTarget;
    /** Whether to use streaming mode */
    streaming?: boolean;
    /** Conversation history for follow-up questions */
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    /** Maximum output tokens */
    maxTokens?: number;
    /** Bounded confidence adjustment from aggregate 👍/👎 feedback (default 0). */
    confidenceCalibration?: number;
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
    confidenceLevel: ConfidenceLevel;
    /** Confidence score (0-1) */
    confidenceScore: number;
    /** Search results used as context */
    searchResults: SearchResult[];
    /** Token usage across all Claude calls */
    tokenUsage: TokenUsage;
    /** End-to-end latency in milliseconds */
    latencyMs: number;
}
