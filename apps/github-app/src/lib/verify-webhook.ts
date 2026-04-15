import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify the HMAC-SHA256 signature of an incoming GitHub webhook request.
 *
 * GitHub sends the signature in the `x-hub-signature-256` header as
 * `sha256=<hex-digest>`. This function recomputes the digest using the
 * shared secret and performs a timing-safe comparison.
 */
export function verifyWebhookSignature(
    payload: string | Buffer,
    signature: string | undefined,
    secret: string,
): boolean {
    if (!signature) return false;

    const prefix = 'sha256=';
    if (!signature.startsWith(prefix)) return false;

    const receivedHex = signature.slice(prefix.length);

    const expectedHex = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

    // Both are hex strings of the same hash algorithm, so lengths match.
    // Use Buffer comparison for timing-safe equality.
    const receivedBuf = Buffer.from(receivedHex, 'hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');

    if (receivedBuf.length !== expectedBuf.length) return false;

    return timingSafeEqual(receivedBuf, expectedBuf);
}
