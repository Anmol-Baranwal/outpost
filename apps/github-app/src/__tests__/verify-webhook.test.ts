import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from '../lib/verify-webhook.js';

const SECRET = 'test-webhook-secret';

function sign(payload: string, secret: string): string {
    const digest = createHmac('sha256', secret).update(payload).digest('hex');
    return `sha256=${digest}`;
}

describe('verifyWebhookSignature', () => {
    it('returns true for a valid signature', () => {
        const payload = '{"action":"opened"}';
        const signature = sign(payload, SECRET);

        expect(verifyWebhookSignature(payload, signature, SECRET)).toBe(true);
    });

    it('returns false for an invalid signature', () => {
        const payload = '{"action":"opened"}';
        const signature = sign(payload, 'wrong-secret');

        expect(verifyWebhookSignature(payload, signature, SECRET)).toBe(false);
    });

    it('returns false when signature is undefined', () => {
        expect(verifyWebhookSignature('body', undefined, SECRET)).toBe(false);
    });

    it('returns false when signature is missing sha256= prefix', () => {
        expect(verifyWebhookSignature('body', 'abcdef1234', SECRET)).toBe(false);
    });

    it('returns false for a tampered payload', () => {
        const original = '{"action":"opened"}';
        const tampered = '{"action":"closed"}';
        const signature = sign(original, SECRET);

        expect(verifyWebhookSignature(tampered, signature, SECRET)).toBe(false);
    });

    it('works with Buffer payloads', () => {
        const payload = Buffer.from('{"action":"opened"}');
        const signature = sign(payload.toString(), SECRET);

        expect(verifyWebhookSignature(payload, signature, SECRET)).toBe(true);
    });
});
