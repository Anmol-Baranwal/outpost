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
let rotationIndex = 0;
/**
 * Parse the on-call member list from an environment variable or explicit list.
 */
export function getOnCallMembers(envValue) {
    const raw = envValue ?? process.env.ON_CALL_MEMBERS ?? '';
    return raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
}
/**
 * Get the current on-call team member ID using round-robin rotation.
 *
 * Returns null if no on-call members are configured.
 * Each call advances the rotation to the next member.
 */
export function getCurrentOnCall(members) {
    const onCallMembers = members ?? getOnCallMembers();
    if (onCallMembers.length === 0) {
        return null;
    }
    const currentIndex = rotationIndex % onCallMembers.length;
    rotationIndex = (rotationIndex + 1) % onCallMembers.length;
    return onCallMembers[currentIndex];
}
/**
 * Peek at the current on-call member without advancing the rotation.
 */
export function peekOnCall(members) {
    const onCallMembers = members ?? getOnCallMembers();
    if (onCallMembers.length === 0) {
        return null;
    }
    return onCallMembers[rotationIndex % onCallMembers.length];
}
/**
 * Reset the rotation index. Primarily useful for testing.
 */
export function resetRotation() {
    rotationIndex = 0;
}
