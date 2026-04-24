/**
 * Tests for the email sender.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendEmail } from '../../email/sender.js';
import type { EmailTransport, EmailSendOptions } from '../../email/sender.js';
import type { TemplateContext } from '../types.js';

describe('sendEmail', () => {
    const context: TemplateContext = {
        org: { name: 'TestCorp', email: 'support@testcorp.com' },
        member: { name: 'Alice', email: 'alice@test.com', invitedBy: 'Bob', role: 'Engineer' },
        invite: { url: 'https://app.test/invite/abc', expiresIn: '7 days' },
    };

    beforeEach(() => {
        delete process.env.POSTMARK_SERVER_TOKEN;
        delete process.env.SMTP_HOST;
    });

    it('sends via injected transport successfully', async () => {
        const mockTransport: EmailTransport = {
            send: vi.fn().mockResolvedValue({ id: 'msg-123' }),
        };

        const result = await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            transport: mockTransport,
        });

        expect(result.success).toBe(true);
        expect(result.method).toBe('postmark');
        expect(result.messageId).toBe('msg-123');
        expect(mockTransport.send).toHaveBeenCalledWith(
            expect.objectContaining({
                to: ['alice@test.com'],
                subject: expect.stringContaining('TestCorp'),
            }),
        );
    });

    it('handles transport errors gracefully', async () => {
        const mockTransport: EmailTransport = {
            send: vi.fn().mockResolvedValue({ error: 'Rate limited' }),
        };

        const result = await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            transport: mockTransport,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Rate limited');
        expect(result.method).toBe('postmark');
    });

    it('handles transport exceptions', async () => {
        const mockTransport: EmailTransport = {
            send: vi.fn().mockRejectedValue(new Error('Network failure')),
        };

        const result = await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            transport: mockTransport,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Network failure');
        expect(result.method).toBe('postmark');
    });

    it('falls back to console when no transport and no POSTMARK_SERVER_TOKEN', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const result = await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
        });

        expect(result.success).toBe(true);
        expect(result.method).toBe('console');
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
    });

    it('returns error for nonexistent template', async () => {
        const result = await sendEmail({
            to: 'alice@test.com',
            template: 'does-not-exist',
            context,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
    });

    it('accepts array of recipients', async () => {
        const mockTransport: EmailTransport = {
            send: vi.fn().mockResolvedValue({ id: 'msg-456' }),
        };

        const result = await sendEmail({
            to: ['alice@test.com', 'bob@test.com'],
            template: 'invite',
            context,
            transport: mockTransport,
        });

        expect(result.success).toBe(true);
        expect(mockTransport.send).toHaveBeenCalledWith(
            expect.objectContaining({
                to: ['alice@test.com', 'bob@test.com'],
            }),
        );
    });

    it('interpolates the from address from template', async () => {
        const mockTransport: EmailTransport = {
            send: vi.fn().mockResolvedValue({ id: 'msg-789' }),
        };

        await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            transport: mockTransport,
        });

        expect(mockTransport.send).toHaveBeenCalledWith(
            expect.objectContaining({
                from: expect.stringContaining('TestCorp'),
            }),
        );
    });

    it('passes threading headers to transport', async () => {
        const mockTransport: EmailTransport = {
            send: vi.fn().mockResolvedValue({ id: 'msg-thread' }),
        };

        const result = await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            transport: mockTransport,
            replyTo: 'ticket+TKT-1234@support.test.com',
            messageId: '<unique-id@test.com>',
            inReplyTo: '<original-msg@test.com>',
            references: '<original-msg@test.com>',
        });

        expect(result.success).toBe(true);
        const sendCall = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as EmailSendOptions;
        expect(sendCall.replyTo).toBe('ticket+TKT-1234@support.test.com');
        expect(sendCall.messageId).toBe('<unique-id@test.com>');
        expect(sendCall.inReplyTo).toBe('<original-msg@test.com>');
        expect(sendCall.references).toBe('<original-msg@test.com>');
    });

    it('passes undefined threading headers when not provided', async () => {
        const mockTransport: EmailTransport = {
            send: vi.fn().mockResolvedValue({ id: 'msg-no-thread' }),
        };

        await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            transport: mockTransport,
        });

        const sendCall = (mockTransport.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as EmailSendOptions;
        expect(sendCall.replyTo).toBeUndefined();
        expect(sendCall.messageId).toBeUndefined();
        expect(sendCall.inReplyTo).toBeUndefined();
        expect(sendCall.references).toBeUndefined();
    });

    it('logs reply-to header in console fallback', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await sendEmail({
            to: 'alice@test.com',
            template: 'invite',
            context,
            replyTo: 'ticket+TKT-1234@support.test.com',
        });

        const loggedTexts = consoleSpy.mock.calls.map((c) => String(c[0]));
        expect(loggedTexts).toContain('Reply-To: ticket+TKT-1234@support.test.com');
        consoleSpy.mockRestore();
    });
});
