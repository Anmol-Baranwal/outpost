/**
 * Repository allowlist guard.
 *
 * The GitHub App reacts to whatever repo its webhook fires for. Without a gate
 * it answers issues on ANY repo it's installed on — including CopilotKit/outpost
 * itself. This restricts inbound handling to an explicit allowlist
 * (default: CopilotKit/CopilotKit).
 */

/**
 * Whether an inbound event from `fullName` (e.g. "CopilotKit/CopilotKit")
 * should be processed. Comparison is case-insensitive.
 *
 * An empty allowlist means "no restriction configured" → allow all, so a
 * single-tenant install without config still works. The shipped default is
 * non-empty, so out of the box only the allowlisted repos are answered.
 */
export function isRepoAllowed(
    fullName: string | null | undefined,
    allowedRepos: readonly string[],
): boolean {
    if (!fullName) return false;
    if (allowedRepos.length === 0) return true;
    const target = fullName.toLowerCase();
    return allowedRepos.some((r) => r.toLowerCase() === target);
}
