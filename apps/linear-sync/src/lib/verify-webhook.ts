import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a Linear webhook signature using HMAC-SHA256.
 *
 * Linear sends the signature in the `Linear-Signature` header.
 * The signature is the hex-encoded HMAC-SHA256 of the raw request body
 * using the webhook secret as the key.
 *
 * @param rawBody  - The raw request body as a Buffer or string
 * @param signature - The value of the `Linear-Signature` header
 * @param secret   - The LINEAR_WEBHOOK_SECRET
 * @returns true if the signature is valid, false otherwise
 */
export function verifyWebhookSignature(
    rawBody: Buffer | string,
    signature: string,
    secret: string,
): boolean {
    if (!signature || !secret) {
        return false;
    }

    const expected = createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (sigBuffer.length !== expectedBuffer.length) {
        return false;
    }

    return timingSafeEqual(sigBuffer, expectedBuffer);
}
