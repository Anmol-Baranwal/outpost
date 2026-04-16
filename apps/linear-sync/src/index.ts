import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { config } from './config.js';
import { startHealthServer } from './health.js';
import { verifyWebhookSignature } from './lib/verify-webhook.js';
import { parseIssueCreated } from './webhooks/issue-created.js';
import { parseIssueUpdated } from './webhooks/issue-updated.js';
import { parseCommentCreated } from './webhooks/comment-created.js';
import {
    handleIssueCreated,
    handleIssueUpdated,
    handleCommentCreated,
    type SyncHandlerDeps,
} from './webhooks/sync-handler.js';

/**
 * Sync handler deps — in production these are wired to the real Prisma client.
 * Declared here so the webhook handler can reference them. The deps are set
 * via setSyncDeps() from the app bootstrap (or tests).
 */
let syncDeps: SyncHandlerDeps | null = null;

export function setSyncDeps(deps: SyncHandlerDeps): void {
    syncDeps = deps;
}

/**
 * Read the full request body as a Buffer.
 */
function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

/**
 * Send a JSON response.
 */
function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

/**
 * Handle incoming Linear webhook events.
 */
async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawBody = await readBody(req);
    const signature = req.headers['linear-signature'];

    if (typeof signature !== 'string') {
        console.warn('[Linear Sync] Missing Linear-Signature header');
        jsonResponse(res, 401, { error: 'Missing signature' });
        return;
    }

    if (!verifyWebhookSignature(rawBody, signature, config.linearWebhookSecret)) {
        console.warn('[Linear Sync] Invalid webhook signature');
        jsonResponse(res, 401, { error: 'Invalid signature' });
        return;
    }

    let payload: { action?: string; type?: string };
    try {
        payload = JSON.parse(rawBody.toString('utf-8'));
    } catch {
        console.warn('[Linear Sync] Failed to parse webhook body');
        jsonResponse(res, 400, { error: 'Invalid JSON' });
        return;
    }

    const { action, type } = payload;
    console.log(`[Linear Sync] Received ${type ?? 'unknown'} ${action ?? 'unknown'} event`);

    try {
        if (type === 'Issue' && action === 'create') {
            const parsed = parseIssueCreated(payload);
            console.log(`[Linear Sync] Issue created: ${parsed.title} (${parsed.issueId})`);

            if (syncDeps) {
                const result = await handleIssueCreated(syncDeps, parsed);
                console.log(`[Linear Sync] Created Outpost ticket ${result.ticketId} for Linear issue ${parsed.issueId}`);
            }
        } else if (type === 'Issue' && action === 'update') {
            const parsed = parseIssueUpdated(payload);
            console.log(
                `[Linear Sync] Issue updated: ${parsed.issueId}, fields: ${parsed.updatedFields.join(', ')}`,
            );

            if (syncDeps) {
                const result = await handleIssueUpdated(syncDeps, parsed);
                if (result.updated) {
                    console.log(`[Linear Sync] Updated Outpost ticket ${result.ticketId} from Linear issue ${parsed.issueId}`);
                } else {
                    console.log(`[Linear Sync] No linked ticket found for Linear issue ${parsed.issueId}`);
                }
            }
        } else if (type === 'Comment' && action === 'create') {
            const parsed = parseCommentCreated(payload);
            console.log(
                `[Linear Sync] Comment created on issue ${parsed.issueId} by ${parsed.userName ?? parsed.userId ?? 'unknown'}`,
            );

            if (syncDeps) {
                const result = await handleCommentCreated(syncDeps, parsed);
                if (result.created) {
                    console.log(`[Linear Sync] Created message ${result.messageId} on ticket ${result.ticketId}`);
                } else {
                    console.log(`[Linear Sync] No linked ticket found for Linear issue ${parsed.issueId}`);
                }
            }
        } else {
            console.log(`[Linear Sync] Ignoring unhandled event: ${type} ${action}`);
        }

        jsonResponse(res, 200, { ok: true });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[Linear Sync] Error processing webhook: ${message}`);
        jsonResponse(res, 400, { error: message });
    }
}

/**
 * Main HTTP server routing.
 */
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'POST' && req.url === '/webhooks/linear') {
        handleWebhook(req, res).catch((err) => {
            console.error('[Linear Sync] Unhandled error in webhook handler:', err);
            if (!res.headersSent) {
                jsonResponse(res, 500, { error: 'Internal server error' });
            }
        });
        return;
    }

    if (req.method === 'GET' && req.url === '/health') {
        jsonResponse(res, 200, {
            status: 'ok',
            service: 'linear-sync',
            uptime: Math.floor((Date.now() - startedAt) / 1000),
        });
        return;
    }

    jsonResponse(res, 404, { error: 'Not found' });
}

const startedAt = Date.now();

const server: Server = createServer(handleRequest);

server.listen(config.port, () => {
    console.log(`[Linear Sync] Webhook server listening on port ${config.port}`);
});

// Graceful shutdown
const shutdown = () => {
    console.log('[Linear Sync] Shutting down...');
    server.close(() => {
        process.exit(0);
    });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { server };
