/**
 * Condition matcher for routing rules.
 *
 * Each condition type has a corresponding matcher function that evaluates
 * whether a ticket satisfies the condition.
 */
import type { RuleCondition, RoutingTicket } from './types.js';
/**
 * Evaluate whether a ticket matches a rule condition.
 * Returns a confidence score between 0 and 1.
 */
export declare function matchCondition(condition: RuleCondition, ticket: RoutingTicket): number;
//# sourceMappingURL=matcher.d.ts.map