/**
 * Types for the human dispatch / routing engine.
 *
 * Routing rules are defined as JSON-serializable config objects.
 * Each rule has a condition matcher and a target (role or specific member).
 */

import type { TeamMemberRole } from '../types.js';

// ─── Condition Types ───────────────────────────────────────────────────────

/**
 * A keyword-based condition that matches against ticket title/description.
 */
export interface KeywordCondition {
    type: 'keyword';
    /** Keywords to match (case-insensitive, any match triggers the rule) */
    keywords: string[];
    /** Match against 'title', 'description', or 'both' (default: 'both') */
    field?: 'title' | 'description' | 'both';
}

/**
 * A condition that matches tickets from a specific source.
 */
export interface SourceCondition {
    type: 'source';
    /** Ticket source to match (e.g. 'GITHUB_ISSUE', 'DISCORD') */
    sources: string[];
}

/**
 * A condition that matches accounts above a certain ACV threshold.
 */
export interface AcvCondition {
    type: 'acv';
    /** Minimum ACV threshold in dollars */
    minAcv: number;
}

/**
 * A condition that matches a specific ticket type.
 */
export interface TicketTypeCondition {
    type: 'ticketType';
    /** Ticket types to match */
    ticketTypes: string[];
}

/**
 * Union of all supported condition types.
 */
export type RuleCondition =
    | KeywordCondition
    | SourceCondition
    | AcvCondition
    | TicketTypeCondition;

// ─── Rule Definition ───────────────────────────────────────────────────────

/**
 * A single routing rule. Rules are evaluated in priority order (lowest number = highest priority).
 */
export interface RoutingRule {
    /** Unique name for the rule */
    name: string;
    /** Human-readable description */
    description: string;
    /** Condition that must be satisfied for this rule to match */
    condition: RuleCondition;
    /** Target role to route to (used when no specific member is set) */
    targetRole?: TeamMemberRole;
    /** Target specific team member ID (takes precedence over targetRole) */
    targetMemberId?: string;
    /** Priority for rule evaluation — lower number = evaluated first */
    priority: number;
    /** Whether this rule is active */
    enabled: boolean;
}

// ─── Evaluation Input ──────────────────────────────────────────────────────

/**
 * The ticket data needed for routing evaluation.
 * This is a subset of the full ticket + account data,
 * kept minimal to avoid coupling to the Prisma model.
 */
export interface RoutingTicket {
    id: string;
    title: string;
    description: string;
    source: string;
    type: string;
    priority: string;
    account?: {
        id: string;
        acv?: number | null;
        owner?: string | null;
    } | null;
    assigneeId?: string | null;
}

// ─── Evaluation Result ─────────────────────────────────────────────────────

export interface RoutingResult {
    /** The team member to assign the ticket to (null if no match and no on-call) */
    targetMemberId: string | null;
    /** The rule that matched (null if fell through to on-call) */
    matchedRule: RoutingRule | null;
    /** Confidence score 0-1 for the routing decision */
    confidence: number;
    /** Human-readable explanation of the routing decision */
    reason: string;
}

// ─── Team Member Lookup ────────────────────────────────────────────────────

/**
 * Minimal team member info needed by the routing engine.
 */
export interface RoutingTeamMember {
    id: string;
    name: string;
    role: TeamMemberRole;
}
