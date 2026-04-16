/**
 * Tests for the email sender.
 */
import { describe, it, expect, vi } from 'vitest';
import { sendEmail } from '../../email/sender.js';
import type { EmailTransport } from '../../email/sender.js';
import type { TemplateContext } from '../types.js';

describe('sendEmail', () => {
    const context: TemplateContext = {
        org: { name: 'TestCorp', email: 'support@testcorp.com' },
        member: { name: 'Alice', email: 'alice@test.com', invitedBy: 'Bob', role: 'Engineer' },
        invite: { url: 'https://app.test/invite/abc', expiresIn: '7 days' },
    };

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
        expect(result.method).toBe('resend');
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
        expect(result.method).toBe('resend');
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
        expect(result.method).toBe('resend');
    });

    it('falls back to console when no transport and no RESEND_API_KEY', async () => {
        const originalKey = process.env.RESEND_API_KEY;
        delete process.env.RESEND_API_KEY;
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
        if (originalKey !== undefined) {
            process.env.RESEND_API_KEY = originalKey;
        }
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
});
