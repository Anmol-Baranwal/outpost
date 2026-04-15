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

// Start HTTP server for webhook delivery
const middleware = createNodeMiddleware(webhooks, { path: '/api/webhooks/github' });
const server = createServer(middleware);

server.listen(config.port, () => {
    console.log(`[GitHub App] Listening for webhooks on port ${config.port}`);
    console.log(`[GitHub App] Webhook endpoint: http://localhost:${config.port}/api/webhooks/github`);
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
