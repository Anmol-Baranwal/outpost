import { createServer } from 'node:http';
import { Webhooks, createNodeMiddleware } from '@octokit/webhooks';
import { config } from './config.js';
import { handleIssueOpened } from './webhooks/issues-opened.js';
import { handleIssueComment } from './webhooks/issue-comment.js';
import { handleDiscussionCreated } from './webhooks/discussion-created.js';

const webhooks = new Webhooks({
    secret: config.webhookSecret,
});

// Register webhook handlers
webhooks.on('issues.opened', handleIssueOpened);
webhooks.on('issue_comment.created', handleIssueComment);
webhooks.on('discussion.created', handleDiscussionCreated);

// Error handler
webhooks.onError((error) => {
    console.error('[GitHub App] Webhook error:', error);
});

// Webhook middleware handles signature verification internally
const webhookMiddleware = createNodeMiddleware(webhooks, {
    path: '/api/webhooks/github',
});

const server = createServer((req, res) => {
    // Health check endpoint
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'github-app' }));
        return;
    }

    // Delegate everything else to the webhook middleware
    webhookMiddleware(req, res, () => {
        // If the middleware didn't handle the request, return 404
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    });
});

server.listen(config.port, () => {
    console.log(`[GitHub App] Listening for webhooks on port ${config.port}`);
    console.log(`[GitHub App] Webhook endpoint: http://localhost:${config.port}/api/webhooks/github`);
    console.log(`[GitHub App] Health check: http://localhost:${config.port}/health`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('[GitHub App] Shutting down...');
    server.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('[GitHub App] Shutting down...');
    server.close();
    process.exit(0);
});

export { server, webhooks };
