/**
 * Tests for Postmark and SMTP transport factories.
 *
 * Note: The factories use dynamic `import()` for postmark/nodemailer,
 * which is hard to mock reliably. We test the factory null-returns
 * (env-not-set) and test the transport behavior via the injected
 * transport path in sendEmail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPostmarkTransport, createSmtpTransport, sendEmail } from '../sender.js';
import type { EmailTransport, EmailSendOptions } from '../sender.js';

describe('createPostmarkTransport', () => {
    const originalToken = process.env.POSTMARK_SERVER_TOKEN;

    afterEach(() => {
        if (originalToken !== undefined) {
            process.env.POSTMARK_SERVER_TOKEN = originalToken;
        } else {
            delete process.env.POSTMARK_SERVER_TOKEN;
        }
    });

    it('returns null when POSTMARK_SERVER_TOKEN is not set', async () => {
        delete process.env.POSTMARK_SERVER_TOKEN;
        const transport = await createPostmarkTransport();
        expect(transport).toBeNull();
    });

    it('returns null when POSTMARK_SERVER_TOKEN is empty string', async () => {
        process.env.POSTMARK_SERVER_TOKEN = '';
        const transport = await createPostmarkTransport();
        expect(transport).toBeNull();
    });
});

describe('createSmtpTransport', () => {
    const originalHost = process.env.SMTP_HOST;

    afterEach(() => {
        if (originalHost !== undefined) {
            process.env.SMTP_HOST = originalHost;
        } else {
            delete process.env.SMTP_HOST;
        }
    });

    it('returns null when SMTP_HOST is not set', async () => {
        delete process.env.SMTP_HOST;
        const transport = await createSmtpTransport();
        expect(transport).toBeNull();
    });

    it('returns null when SMTP_HOST is empty string', async () => {
        process.env.SMTP_HOST = '';
        const transport = await createSmtpTransport();
        expect(transport).toBeNull();
    });
});

describe('Postmark transport behavior via injected mock', () => {
    let capturedOpts: EmailSendOptions | undefined;

    const context = {
        org: { name: 'TestCorp', email: 'support@testcorp.com' },
        member: { name: 'Alice', email: 'alice@test.com', invitedBy: 'Bob', role: 'Engineer' },
        invite: { url: 'https://app.test/invite/abc', expiresIn: '7 days' },
    };

    beforeEach(() => {
        capturedOpts = undefined;
        delete process.env.POSTMARK_SERVER_TOKEN;
        delete process.env.SMTP_HOST;
    });

    function capturingTransport(response: { id?: string; error?: string } = { id: 'pm-mock-id' }): EmailTransport {
        return {
            send: vi.fn(async (opts: EmailSendOptions) => {
                capturedOpts = opts;
                return response;
            }),
        };
    }

    it('passes from/to/subject/html/text correctly', async () => {
        const transport = capturingTransport();

        await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            transport,
        });

        expect(capturedOpts).toBeDefined();
        expect(capturedOpts!.from).toContain('TestCorp');
        expect(capturedOpts!.to).toEqual(['alice@test.com']);
        expect(capturedOpts!.subject).toContain('TestCorp');
        expect(capturedOpts!.html).toContain('<!DOCTYPE html>');
        expect(capturedOpts!.text).toBeTruthy();
    });

    it('passes threading headers when provided', async () => {
        const transport = capturingTransport();

        await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            transport,
            replyTo: 'ticket+TKT-1234@support.test.com',
            messageId: '<custom-id@test.com>',
            inReplyTo: '<original@test.com>',
            references: '<original@test.com> <second@test.com>',
        });

        expect(capturedOpts!.replyTo).toBe('ticket+TKT-1234@support.test.com');
        expect(capturedOpts!.messageId).toBe('<custom-id@test.com>');
        expect(capturedOpts!.inReplyTo).toBe('<original@test.com>');
        expect(capturedOpts!.references).toBe('<original@test.com> <second@test.com>');
    });

    it('omits threading headers when not provided', async () => {
        const transport = capturingTransport();

        await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            transport,
        });

        expect(capturedOpts!.replyTo).toBeUndefined();
        expect(capturedOpts!.messageId).toBeUndefined();
        expect(capturedOpts!.inReplyTo).toBeUndefined();
        expect(capturedOpts!.references).toBeUndefined();
    });

    it('returns postmark method when using injected transport', async () => {
        const transport = capturingTransport();

        const result = await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            transport,
        });

        expect(result.method).toBe('postmark');
        expect(result.success).toBe(true);
        expect(result.messageId).toBe('pm-mock-id');
    });

    it('returns error details from transport', async () => {
        const transport = capturingTransport({ error: 'Invalid API key' });

        const result = await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            transport,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid API key');
        expect(result.method).toBe('postmark');
    });

    it('handles transport exception gracefully', async () => {
        const transport: EmailTransport = {
            send: vi.fn().mockRejectedValue(new Error('Connection refused')),
        };

        const result = await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            transport,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Connection refused');
        expect(result.method).toBe('postmark');
    });

    it('handles non-Error exception gracefully', async () => {
        const transport: EmailTransport = {
            send: vi.fn().mockRejectedValue('string error'),
        };

        const result = await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            transport,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Send failed');
    });
});
