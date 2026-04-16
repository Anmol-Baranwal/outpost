/**
 * Email sender.
 *
 * Uses Resend when RESEND_API_KEY is set. Falls back to console.log in dev.
 */
import { renderTemplate } from '../templates/renderer.js';
import { interpolate } from '../templates/interpolate.js';
import type { TemplateContext } from '../templates/types.js';
import { loadTemplate } from '../templates/loader.js';

interface SendEmailOptions {
    to: string | string[];
    template: string;
    context: TemplateContext;
    dbLookup?: (slug: string) => Promise<{ subject: string; body: string } | null>;
    /** Override the transport for testing. */
    transport?: EmailTransport;
}

interface EmailResult {
    success: boolean;
    messageId?: string;
    error?: string;
    method: 'resend' | 'console';
}

/** Abstraction over the email transport so we can inject mocks. */
export interface EmailTransport {
    send(opts: {
        from: string;
        to: string[];
        subject: string;
        html: string;
        text: string;
    }): Promise<{ id?: string; error?: string }>;
}

/** Create a Resend transport. Returns null if RESEND_API_KEY is not set. */
export async function createResendTransport(): Promise<EmailTransport | null> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return null;

    try {
        const { Resend } = await import('resend');
        const client = new Resend(apiKey);
        return {
            async send(opts) {
                const result = await client.emails.send(opts);
                if (result.error) {
                    return { error: result.error.message };
                }
                return { id: result.data?.id };
            },
        };
    } catch {
        return null;
    }
}

/**
 * Send an email using a template.
 *
 * Loads the template, interpolates variables, renders to HTML + text,
 * and sends via the provided transport (or Resend, or console fallback).
 */
export async function sendEmail(options: SendEmailOptions): Promise<EmailResult> {
    const { to, template, context, dbLookup, transport: injectedTransport } = options;

    const rendered = await renderTemplate(template, context, dbLookup);
    if (!rendered) {
        return { success: false, error: `Template "${template}" not found`, method: 'console' };
    }

    // Resolve the "from" address
    const loaded = await loadTemplate(template, dbLookup);
    const fromAddress = loaded ? interpolate(loaded.meta.from, context) : undefined;

    const recipients = Array.isArray(to) ? to : [to];

    const transport = injectedTransport ?? await createResendTransport();
    if (transport) {
        try {
            const result = await transport.send({
                from: fromAddress || 'Outpost <noreply@outpost.dev>',
                to: recipients,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
            });

            if (result.error) {
                return { success: false, error: result.error, method: 'resend' };
            }

            return { success: true, messageId: result.id, method: 'resend' };
        } catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : 'Send failed',
                method: 'resend',
            };
        }
    }

    // Dev fallback: log to console
    console.log('=== EMAIL (dev mode) ===');
    console.log(`To: ${recipients.join(', ')}`);
    console.log(`From: ${fromAddress || 'Outpost <noreply@outpost.dev>'}`);
    console.log(`Subject: ${rendered.subject}`);
    console.log('--- Text ---');
    console.log(rendered.text);
    console.log('========================');

    return { success: true, method: 'console' };
}

export type { SendEmailOptions, EmailResult };
