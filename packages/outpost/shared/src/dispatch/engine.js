/**
 * Routing engine for human dispatch.
 *
 * Evaluates routing rules against a ticket to determine which team member
 * should handle it. Falls back to on-call rotation when no rule matches.
 */
import { DEFAULT_ROUTING_RULES } from './default-rules.js';
import { matchCondition } from './matcher.js';
import { getCurrentOnCall } from './on-call.js';
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
export function evaluateRouting(ticket, teamMembers, rules, onCallMembers) {
    const activeRules = (rules ?? DEFAULT_ROUTING_RULES)
        .filter((rule) => rule.enabled)
        .sort((a, b) => a.priority - b.priority);
    for (const rule of activeRules) {
        const confidence = matchCondition(rule.condition, ticket);
        if (confidence > 0) {
            const targetMemberId = resolveTarget(rule, ticket, teamMembers);
            return {
                targetMemberId,
                matchedRule: rule,
                confidence,
                reason: targetMemberId
                    ? `Matched rule "${rule.name}": ${rule.description}`
                    : `Matched rule "${rule.name}" but no team member found for target`,
            };
        }
    }
    // No rule matched — fall back to on-call
    const onCallMemberId = getCurrentOnCall(onCallMembers);
    return {
        targetMemberId: onCallMemberId,
        matchedRule: null,
        confidence: 0.3,
        reason: onCallMemberId
            ? `No routing rule matched. Assigned to on-call member.`
            : `No routing rule matched and no on-call members configured.`,
    };
}
/**
 * Resolve the target team member for a matched rule.
 *
 * For ACV-based rules, prefers the account owner if set.
 * Otherwise finds the first team member matching the target role.
 */
function resolveTarget(rule, ticket, teamMembers) {
    // If a specific member ID is set on the rule, use it directly
    if (rule.targetMemberId) {
        return rule.targetMemberId;
    }
    // For ACV conditions, prefer account owner
    if (rule.condition.type === 'acv' && ticket.account?.owner) {
        // Find the team member whose name or ID matches the account owner
        const owner = teamMembers.find((m) => m.id === ticket.account?.owner || m.name === ticket.account?.owner);
        if (owner) {
            return owner.id;
        }
    }
    // Fall back to role-based routing
    if (rule.targetRole) {
        const member = teamMembers.find((m) => m.role === rule.targetRole);
        if (member) {
            return member.id;
        }
    }
    return null;
}
/**
 * Dry-run evaluation: returns the routing result without side effects.
 * Identical to evaluateRouting but named explicitly for the API.
 */
export function dryRunRouting(ticket, teamMembers, rules, onCallMembers) {
    return evaluateRouting(ticket, teamMembers, rules, onCallMembers);
}
