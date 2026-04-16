import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from '../lib/verify-webhook.js';

const SECRET = 'test-webhook-secret-123';

function sign(body: string, secret: string): string {
    return createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyWebhookSignature', () => {
    it('accepts a valid signature', () => {
        const body = '{"action":"create","type":"Issue"}';
        const signature = sign(body, SECRET);

        expect(verifyWebhookSignature(body, signature, SECRET)).toBe(true);
    });

    it('accepts a valid signature from a Buffer body', () => {
        const body = Buffer.from('{"action":"create","type":"Issue"}');
        const signature = sign(body.toString(), SECRET);

        expect(verifyWebhookSignature(body, signature, SECRET)).toBe(true);
    });

    it('rejects an invalid signature', () => {
        const body = '{"action":"create","type":"Issue"}';
        const wrongSignature = sign(body, 'wrong-secret');

        expect(verifyWebhookSignature(body, wrongSignature, SECRET)).toBe(false);
    });

    it('rejects when body has been tampered with', () => {
        const originalBody = '{"action":"create","type":"Issue"}';
        const signature = sign(originalBody, SECRET);
        const tamperedBody = '{"action":"create","type":"Comment"}';

        expect(verifyWebhookSignature(tamperedBody, signature, SECRET)).toBe(false);
    });

    it('rejects an empty signature', () => {
        const body = '{"action":"create","type":"Issue"}';

        expect(verifyWebhookSignature(body, '', SECRET)).toBe(false);
    });

    it('rejects an empty secret', () => {
        const body = '{"action":"create","type":"Issue"}';

        expect(verifyWebhookSignature(body, 'some-sig', '')).toBe(false);
    });
});
