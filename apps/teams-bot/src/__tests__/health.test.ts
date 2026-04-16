import { describe, it, expect, afterEach } from 'vitest';
import { startHealthServer } from '../health.js';
import type { Server } from 'node:http';

describe('startHealthServer', () => {
    let server: Server;

    afterEach(() => {
        server?.close();
    });

    it('responds with 200 on /health', async () => {
        server = startHealthServer(0); // port 0 = random available port

        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Server did not bind to a port');
        }

        const res = await fetch(`http://localhost:${address.port}/health`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(body.service).toBe('teams-bot');
        expect(typeof body.uptime).toBe('number');
    });

    it('responds with 404 on unknown routes', async () => {
        server = startHealthServer(0);

        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Server did not bind to a port');
        }

        const res = await fetch(`http://localhost:${address.port}/unknown`);
        expect(res.status).toBe(404);
    });
});
