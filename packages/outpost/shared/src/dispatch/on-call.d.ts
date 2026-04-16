/**
 * On-call rotation for the dispatch engine.
 *
 * Simple round-robin rotation through a list of team member IDs.
 * The list is configured via the ON_CALL_MEMBERS environment variable
 * (comma-separated team member IDs).
 *
 * The rotation index advances with each call to getCurrentOnCall(),
 * wrapping around when it reaches the end of the list.
 */
/**
 * Parse the on-call member list from an environment variable or explicit list.
 */
export declare function getOnCallMembers(envValue?: string): string[];
/**
 * Get the current on-call team member ID using round-robin rotation.
 *
 * Returns null if no on-call members are configured.
 * Each call advances the rotation to the next member.
 */
export declare function getCurrentOnCall(members?: string[]): string | null;
/**
 * Peek at the current on-call member without advancing the rotation.
 */
export declare function peekOnCall(members?: string[]): string | null;
/**
 * Reset the rotation index. Primarily useful for testing.
 */
export declare function resetRotation(): void;
//# sourceMappingURL=on-call.d.ts.map