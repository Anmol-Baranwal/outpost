/**
 * Client-side CSRF helper.
 *
 * Reads the `csrf` cookie set by middleware and returns the value so callers
 * can attach it as an `X-CSRF-Token` header on mutating fetch requests.
 *
 * Prefer `apiFetch` from '@/lib/api-fetch' over calling this directly — it attaches
 * the header for you on mutating requests. This helper existed as the opt-in way to
 * do that and every caller forgot, which left no authenticated write in the dashboard
 * able to persist. Reach for it only when you need the raw header value.
 *
 * Usage:
 *   import { apiFetch } from '@/lib/api-fetch';
 *   apiFetch('/api/tickets', { method: 'POST', body });
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
