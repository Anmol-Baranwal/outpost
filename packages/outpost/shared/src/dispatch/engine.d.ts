/**
 * Routing engine for human dispatch.
 *
 * Evaluates routing rules against a ticket to determine which team member
 * should handle it. Falls back to on-call rotation when no rule matches.
 */
import type { RoutingRule, RoutingTicket, RoutingResult, RoutingTeamMember } from './types.js';
/**
 * Evaluate all routing rules against a ticket and return the best match.
 *
 * Rules are evaluated in priority order (lowest number first).
 * The first rule whose condition matches with non-zero confidence wins.
 *
 * Special handling:
 * - For 'acv' conditions with account.owner set, the target is the account owner
 * - Falls back to on-call rotation when no rule matches
 *
 * @param ticket - Ticket data to evaluate
 * @param teamMembers - Available team members for role-based routing
 * @param rules - Routing rules to evaluate (defaults to built-in rules)
 * @param onCallMembers - On-call member IDs for fallback (defaults to env var)
 */
export declare function evaluateRouting(ticket: RoutingTicket, teamMembers: RoutingTeamMember[], rules?: RoutingRule[], onCallMembers?: string[]): RoutingResult;
/**
 * Dry-run evaluation: returns the routing result without side effects.
 * Identical to evaluateRouting but named explicitly for the API.
 */
export declare function dryRunRouting(ticket: RoutingTicket, teamMembers: RoutingTeamMember[], rules?: RoutingRule[], onCallMembers?: string[]): RoutingResult;
//# sourceMappingURL=engine.d.ts.map