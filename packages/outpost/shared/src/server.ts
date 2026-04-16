/**
 * Server-only exports that depend on Node.js APIs (fs, path, etc.).
 * Import from '@copilotkit/outpost/shared/server' in API routes
 * and server components only — never in client-side code.
 */
export * from './templates/index.js';
export * from './email/index.js';
