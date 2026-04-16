import {
    CloudAdapter,
    ConfigurationBotFrameworkAuthentication,
    type TurnContext,
    type Request as BotRequest,
    type Response as BotResponse,
} from 'botbuilder';
import { config } from './config.js';
import { handleMessage } from './handlers/message.js';
import { handleCardAction } from './handlers/card-actions.js';
import { startHealthServer } from './health.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const healthPort = parseInt(process.env.HEALTH_PORT ?? '3003', 10);
const botPort = parseInt(process.env.PORT ?? '3978', 10);

// Start health check server on a separate port
const healthServer = startHealthServer(healthPort);

// Configure Bot Framework authentication
const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: config.teamsAppId,
    MicrosoftAppPassword: config.teamsAppPassword,
    MicrosoftAppTenantId: config.teamsTenantId || undefined,
});

// Create the Bot Framework adapter
const adapter = new CloudAdapter(botFrameworkAuth);

// Error handler
adapter.onTurnError = async (context: TurnContext, error: Error) => {
    console.error(`[Teams Bot] Unhandled error: ${error.message}`, error);
    await context.sendActivity('An internal error occurred. Please try again later.');
};

/**
 * Wrap a Node.js IncomingMessage to satisfy the Bot Framework Request interface.
 */
function wrapRequest(req: IncomingMessage, body: Record<string, unknown>): BotRequest {
    return {
        body,
        headers: req.headers as Record<string, string | string[] | undefined>,
        method: req.method,
    };
}

/**
 * Wrap a Node.js ServerResponse to satisfy the Bot Framework Response interface.
 */
function wrapResponse(res: ServerResponse): BotResponse {
    return {
        socket: res.socket,
        end(...args: unknown[]) {
            res.end(...(args as Parameters<typeof res.end>));
        },
        header(name: string, value: unknown) {
            res.setHeader(name, String(value));
        },
        send(bodyOrStatus?: unknown) {
            if (typeof bodyOrStatus === 'object') {
                res.end(JSON.stringify(bodyOrStatus));
            } else {
                res.end(String(bodyOrStatus ?? ''));
            }
        },
        status(code: number) {
            res.statusCode = code;
            return this;
        },
    };
}

/**
 * Read the full request body as JSON.
 */
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf-8');
                resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

// HTTP server for receiving webhook posts from Azure Bot Service
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/api/messages') {
        try {
            const body = await readBody(req);
            const botReq = wrapRequest(req, body);
            const botRes = wrapResponse(res);

            await adapter.process(botReq, botRes, async (context: TurnContext) => {
                // Card submit actions come as 'invoke' or message activities with value
                if (context.activity.value && context.activity.type === 'invoke') {
                    await handleCardAction(context);
                } else if (context.activity.value && context.activity.type === 'message') {
                    // Some card actions come as message with value
                    await handleCardAction(context);
                } else {
                    await handleMessage(context);
                }
            });
        } catch (error) {
            console.error('[Teams Bot] Error processing request:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

server.listen(botPort, () => {
    console.log(`[Teams Bot] Bot server listening on port ${botPort}`);
    console.log(`[Teams Bot] POST /api/messages to receive Teams webhooks`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down Teams bot...');
    healthServer.close();
    server.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Shutting down Teams bot...');
    healthServer.close();
    server.close();
    process.exit(0);
});
