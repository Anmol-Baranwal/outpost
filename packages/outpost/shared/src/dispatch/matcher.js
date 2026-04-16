/**
 * Condition matcher for routing rules.
 *
 * Each condition type has a corresponding matcher function that evaluates
 * whether a ticket satisfies the condition.
 */
/**
 * Evaluate whether a ticket matches a rule condition.
 * Returns a confidence score between 0 and 1.
 */
export function matchCondition(condition, ticket) {
    switch (condition.type) {
        case 'keyword':
            return matchKeyword(condition, ticket);
        case 'source':
            return matchSource(condition, ticket);
        case 'acv':
            return matchAcv(condition, ticket);
        case 'ticketType':
            return matchTicketType(condition, ticket);
        default:
            return 0;
    }
}
/**
 * Match keywords against ticket title and/or description.
 * Returns higher confidence when more keywords match.
 */
function matchKeyword(condition, ticket) {
    const field = condition.field ?? 'both';
    let text = '';
    if (field === 'title' || field === 'both') {
        text += ' ' + ticket.title;
    }
    if (field === 'description' || field === 'both') {
        text += ' ' + ticket.description;
    }
    const normalizedText = text.toLowerCase();
    const matchedKeywords = condition.keywords.filter((kw) => normalizedText.includes(kw.toLowerCase()));
    if (matchedKeywords.length === 0) {
        return 0;
    }
    // Base confidence of 0.7 for a single match, scaling up to 0.95 for many matches
    const matchRatio = matchedKeywords.length / condition.keywords.length;
    return Math.min(0.7 + matchRatio * 0.25, 0.95);
}
/**
 * Match ticket source against allowed sources.
 * Returns 0.9 confidence for exact source match.
 */
function matchSource(condition, ticket) {
    const matches = condition.sources.some((source) => source.toUpperCase() === ticket.source.toUpperCase());
    return matches ? 0.9 : 0;
}
/**
 * Match account ACV against minimum threshold.
 * Returns higher confidence for higher ACV.
 */
function matchAcv(condition, ticket) {
    const acv = ticket.account?.acv;
    if (acv == null || acv < condition.minAcv) {
        return 0;
    }
    // Base confidence of 0.85, scaling up for significantly higher ACV
    const ratio = acv / condition.minAcv;
    return Math.min(0.85 + (ratio - 1) * 0.05, 0.98);
}
/**
 * Match ticket type against allowed types.
 * Returns 0.85 confidence for exact type match.
 */
function matchTicketType(condition, ticket) {
    const matches = condition.ticketTypes.some((tt) => tt.toUpperCase() === ticket.type.toUpperCase());
    return matches ? 0.85 : 0;
}
