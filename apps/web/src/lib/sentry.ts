/**
 * Sentry error tracking stub.
 *
 * Drop-in configuration — set SENTRY_DSN in the environment to activate.
 * Without the DSN, all calls are no-ops so the app still works without Sentry.
 */

interface SentryConfig {
    dsn: string | undefined;
    environment: string;
    release: string;
    tracesSampleRate: number;
}

export const sentryConfig: SentryConfig = {
    dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.npm_package_version ?? '0.1.0',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
};

/**
 * Capture an exception — stub logs to stderr until Sentry SDK is installed.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
    if (!sentryConfig.dsn) {
        console.error('[sentry-stub] exception captured:', error, context ?? '');
        return;
    }

    // When @sentry/nextjs is installed, replace this with:
    //   import * as Sentry from '@sentry/nextjs';
    //   Sentry.captureException(error, { extra: context });
    console.error('[sentry-stub] DSN set but SDK not installed:', error);
}

/**
 * Capture a message — stub logs to stderr until Sentry SDK is installed.
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
    if (!sentryConfig.dsn) {
        console.error(`[sentry-stub] ${level}: ${message}`);
        return;
    }

    console.error(`[sentry-stub] DSN set but SDK not installed — ${level}: ${message}`);
}
