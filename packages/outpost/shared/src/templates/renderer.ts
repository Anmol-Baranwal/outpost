/**
 * Template rendering pipeline.
 *
 * Pipeline: load -> interpolate -> render
 * Output formats: HTML, plain text, or raw Markdown.
 */
import { loadTemplate } from './loader.js';
import { interpolate } from './interpolate.js';
import type { TemplateContext, TemplateResult } from './types.js';

/**
 * Convert Markdown to HTML.
 *
 * Uses a simple Markdown-to-HTML converter that handles the most common
 * patterns: headings, bold, italic, links, lists, tables, paragraphs.
 * This avoids pulling in a heavy dependency like `marked` for what
 * are essentially email templates.
 */
export function markdownToHtml(md: string): string {
    let html = md;

    // Tables: detect and convert Markdown tables
    html = html.replace(
        /^(\|.+\|)\n(\|[\s:|-]+\|)\n((?:\|.+\|\n?)+)/gm,
        (_match, headerRow: string, _separator: string, bodyRows: string) => {
            const headers = headerRow.split('|').filter((c: string) => c.trim());
            const rows = bodyRows.trim().split('\n');
            let table = '<table><thead><tr>';
            for (const h of headers) {
                table += `<th>${h.trim()}</th>`;
            }
            table += '</tr></thead><tbody>';
            for (const row of rows) {
                const cells = row.split('|').filter((c: string) => c.trim());
                table += '<tr>';
                for (const cell of cells) {
                    table += `<td>${cell.trim()}</td>`;
                }
                table += '</tr>';
            }
            table += '</tbody></table>';
            return table;
        },
    );

    // Headings
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Unordered list items
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

    // Horizontal rule
    html = html.replace(/^---$/gm, '<hr>');

    // Paragraphs: wrap remaining non-tag lines
    html = html
        .split('\n\n')
        .map((block) => {
            const trimmed = block.trim();
            if (!trimmed) return '';
            if (trimmed.startsWith('<')) return trimmed;
            return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
        })
        .join('\n');

    return html;
}

/** Wrap HTML content in an email layout. */
export function wrapInEmailLayout(bodyHtml: string, orgName?: string): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px; }
a { color: #2563eb; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; }
th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
th { background-color: #f9fafb; font-weight: 600; }
h1, h2, h3 { margin-top: 24px; margin-bottom: 8px; }
ul { padding-left: 20px; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
.footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
</style>
</head>
<body>
${bodyHtml}
<div class="footer">
Sent by ${orgName || 'Outpost'}
</div>
</body>
</html>`;
}

/** Strip Markdown formatting to produce plain text. */
export function markdownToText(md: string): string {
    let text = md;

    // Remove Markdown links, keep text
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

    // Remove bold/italic markers
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/\*([^*]+)\*/g, '$1');

    // Remove heading markers
    text = text.replace(/^#{1,3} /gm, '');

    // Remove table formatting (keep cell values)
    text = text.replace(/^\|[\s:|-]+\|$/gm, ''); // separator rows
    text = text.replace(/^\|(.+)\|$/gm, (_match, row: string) => {
        return row.split('|').map((c: string) => c.trim()).filter(Boolean).join(' | ');
    });

    // Clean up extra whitespace
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
}

/**
 * Render a template by slug with the given context.
 *
 * Pipeline: load -> interpolate subject + body -> convert to all formats.
 */
export async function renderTemplate(
    slug: string,
    context: TemplateContext,
    dbLookup?: (slug: string) => Promise<{ subject: string; body: string } | null>,
): Promise<TemplateResult | null> {
    const loaded = await loadTemplate(slug, dbLookup);
    if (!loaded) return null;

    const subject = interpolate(loaded.meta.subject, context);
    const markdown = interpolate(loaded.body, context);
    const bodyHtml = markdownToHtml(markdown);
    const orgName = resolveOrgName(context);
    const html = wrapInEmailLayout(bodyHtml, orgName);
    const text = markdownToText(markdown);

    return {
        slug,
        meta: { ...loaded.meta, subject },
        subject,
        html,
        text,
        markdown,
    };
}

function resolveOrgName(context: TemplateContext): string | undefined {
    const org = context.org;
    if (org && typeof org === 'object' && 'name' in org) {
        return String(org.name);
    }
    return undefined;
}
