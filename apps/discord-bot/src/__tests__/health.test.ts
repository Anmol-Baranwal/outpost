import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { startHealthServer } from '../health.js';

describe('Discord bot health server', () => {
    let server: Server;

    afterEach(() => {
        server?.close();
    });

    it('returns status ok with correct shape on GET /health', async () => {
        // Use port 0 so the OS assigns a free port
        server = startHealthServer(0);
        await new Promise<void>((resolve) => server.once('listening', resolve));

        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('unexpected address type');

        const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(body.service).toBe('discord-bot');
        expect(typeof body.uptime).toBe('number');
    });

    it('returns 404 for unknown routes', async () => {
        server = startHealthServer(0);
        await new Promise<void>((resolve) => server.once('listening', resolve));

        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('unexpected address type');

        const res = await fetch(`http://127.0.0.1:${addr.port}/unknown`);
        expect(res.status).toBe(404);
    });
});
