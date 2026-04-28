/**
 * Client-side CSRF helper.
 *
 * Reads the `csrf` cookie set by middleware and returns the value so callers
 * can attach it as an `X-CSRF-Token` header on mutating fetch requests.
 *
 * Usage:
 *   import { csrfHeaders } from '@/lib/csrf-client';
 *   fetch('/api/tickets', { method: 'POST', headers: { ...csrfHeaders() }, body });
 */

function getCsrfCookie(): string | undefined {
    if (typeof document === 'undefined') return undefined;
    const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
    return match?.[1];
}

/**
 * Returns a plain object with the `X-CSRF-Token` header set, suitable for
 * spreading into a fetch `headers` option.  Returns an empty object when
 * running server-side or when no csrf cookie exists.
 */
export function csrfHeaders(): Record<string, string> {
    const token = getCsrfCookie();
    return token ? { 'X-CSRF-Token': token } : {};
}
