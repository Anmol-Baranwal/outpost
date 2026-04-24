/**
 * Email sender.
 *
 * Uses Postmark when POSTMARK_SERVER_TOKEN is set.
 * Falls back to SMTP (nodemailer) when SMTP_HOST is set.
 * Falls back to console.log in dev when neither is configured.
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
    /** Reply-To address, e.g. ticket+TKT-1234@support.copilotkit.ai */
    replyTo?: string;
    /** Custom Message-ID for threading */
    messageId?: string;
    /** In-Reply-To header for threading */
    inReplyTo?: string;
    /** References header for threading */
    references?: string;
}

interface EmailResult {
    success: boolean;
    messageId?: string;
    error?: string;
    method: 'postmark' | 'smtp' | 'console';
}

/** Options passed to a transport's send method. */
export interface EmailSendOptions {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string;
}

/** Abstraction over the email transport so we can inject mocks. */
export interface EmailTransport {
    send(opts: EmailSendOptions): Promise<{ id?: string; error?: string }>;
}

/** Create a Postmark transport. Returns null if POSTMARK_SERVER_TOKEN is not set. */
export async function createPostmarkTransport(): Promise<EmailTransport | null> {
    const serverToken = process.env.POSTMARK_SERVER_TOKEN;
    if (!serverToken) return null;

    try {
        const { ServerClient } = await import('postmark');
        const client = new ServerClient(serverToken);
        return {
            async send(opts: EmailSendOptions) {
                const headers: Array<{ Name: string; Value: string }> = [];

                if (opts.messageId) {
                    headers.push({ Name: 'X-PM-KeepID', Value: 'true' });
                    headers.push({ Name: 'Message-ID', Value: opts.messageId });
                }
                if (opts.inReplyTo) {
                    headers.push({ Name: 'In-Reply-To', Value: opts.inReplyTo });
                }
                if (opts.references) {
                    headers.push({ Name: 'References', Value: opts.references });
                }

                const result = await client.sendEmail({
                    From: opts.from,
                    To: opts.to.join(', '),
                    Subject: opts.subject,
                    HtmlBody: opts.html,
                    TextBody: opts.text,
                    ReplyTo: opts.replyTo,
                    Headers: headers.length > 0 ? headers : undefined,
                    MessageStream: 'outbound',
                });

                return { id: result.MessageID };
            },
        };
    } catch (err) {
        console.error('[Email] POSTMARK_SERVER_TOKEN is set but postmark package failed to load:', err);
        return null;
    }
}

/**
 * Create an SMTP transport via nodemailer. Returns null if SMTP_HOST is not set.
 * nodemailer is an optional peer dependency for self-hosted deployments.
 */
export async function createSmtpTransport(): Promise<EmailTransport | null> {
    const host = process.env.SMTP_HOST;
    if (!host) return null;

    try {
        // nodemailer is an optional dependency -- only installed in self-hosted setups.
        // We use a dynamic require via createRequire to avoid TS module resolution errors.
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const nodemailer = require('nodemailer') as {
            createTransport: (config: Record<string, unknown>) => {
                sendMail: (opts: Record<string, unknown>) => Promise<{ messageId: string }>;
            };
        };
        const transporter = nodemailer.createTransport({
            host,
            port: Number(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: process.env.SMTP_USER
                ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                : undefined,
        });

        return {
            async send(opts: EmailSendOptions) {
                const info = await transporter.sendMail({
                    from: opts.from,
                    to: opts.to.join(', '),
                    subject: opts.subject,
                    html: opts.html,
                    text: opts.text,
                    replyTo: opts.replyTo,
                    messageId: opts.messageId,
                    inReplyTo: opts.inReplyTo,
                    references: opts.references,
                });
                return { id: info.messageId };
            },
        };
    } catch (err) {
        console.error('[Email] SMTP_HOST is set but nodemailer package failed to load:', err);
        return null;
    }
}

/**
 * Send an email using a template.
 *
 * Loads the template, interpolates variables, renders to HTML + text,
 * and sends via the provided transport (or Postmark, or SMTP, or console fallback).
 */
export async function sendEmail(options: SendEmailOptions): Promise<EmailResult> {
    const {
        to,
        template,
        context,
        dbLookup,
        transport: injectedTransport,
        replyTo,
        messageId,
        inReplyTo,
        references,
    } = options;

    const rendered = await renderTemplate(template, context, dbLookup);
    if (!rendered) {
        return { success: false, error: `Template "${template}" not found`, method: 'console' };
    }

    // Resolve the "from" address
    const loaded = await loadTemplate(template, dbLookup);
    const fromAddress = loaded ? interpolate(loaded.meta.from, context) : undefined;

    const recipients = Array.isArray(to) ? to : [to];

    const sendOpts: EmailSendOptions = {
        from: fromAddress || 'Outpost <noreply@outpost.dev>',
        to: recipients,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        replyTo,
        messageId,
        inReplyTo,
        references,
    };

    // Try injected transport first
    if (injectedTransport) {
        return await attemptSend(injectedTransport, sendOpts, 'postmark');
    }

    // Try Postmark
    const postmarkTransport = await createPostmarkTransport();
    if (postmarkTransport) {
        return await attemptSend(postmarkTransport, sendOpts, 'postmark');
    }

    // Try SMTP
    const smtpTransport = await createSmtpTransport();
    if (smtpTransport) {
        return await attemptSend(smtpTransport, sendOpts, 'smtp');
    }

    // Dev fallback: log to console
    console.log('=== EMAIL (dev mode) ===');
    console.log(`To: ${recipients.join(', ')}`);
    console.log(`From: ${sendOpts.from}`);
    console.log(`Subject: ${rendered.subject}`);
    if (replyTo) console.log(`Reply-To: ${replyTo}`);
    console.log('--- Text ---');
    console.log(rendered.text);
    console.log('========================');

    return { success: true, method: 'console' };
}

async function attemptSend(
    transport: EmailTransport,
    opts: EmailSendOptions,
    method: 'postmark' | 'smtp',
): Promise<EmailResult> {
    try {
        const result = await transport.send(opts);

        if (result.error) {
            return { success: false, error: result.error, method };
        }

        return { success: true, messageId: result.id, method };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Send failed',
            method,
        };
    }
}

export type { SendEmailOptions, EmailResult };
