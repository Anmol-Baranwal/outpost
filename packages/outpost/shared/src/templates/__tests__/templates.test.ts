/**
 * Tests for the template engine: loading, interpolation, and rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { interpolate } from '../interpolate.js';
import { parseFrontmatter, loadFromFilesystem, loadTemplate, listTemplateSlugs } from '../loader.js';
import { markdownToHtml, markdownToText, renderTemplate, wrapInEmailLayout } from '../renderer.js';
import type { TemplateContext } from '../types.js';

// ─── Interpolation ──────────────────────────────────────────────────────────

describe('interpolate', () => {
    it('replaces simple variables', () => {
        const result = interpolate('Hello {{name}}!', { name: 'Alice' });
        expect(result).toBe('Hello Alice!');
    });

    it('replaces nested variables', () => {
        const ctx: TemplateContext = {
            org: { name: 'Acme', email: 'team@acme.com' },
        };
        const result = interpolate('From {{org.name}} <{{org.email}}>', ctx);
        expect(result).toBe('From Acme <team@acme.com>');
    });

    it('replaces deeply nested variables', () => {
        const ctx: TemplateContext = {
            a: { b: { c: 'deep' } },
        };
        expect(interpolate('{{a.b.c}}', ctx)).toBe('deep');
    });

    it('replaces missing variables with empty string', () => {
        const result = interpolate('Hello {{missing}}!', {});
        expect(result).toBe('Hello !');
    });

    it('replaces missing nested path with empty string', () => {
        const result = interpolate('{{org.name}}', { org: {} });
        expect(result).toBe('');
    });

    it('handles multiple variables in one string', () => {
        const ctx: TemplateContext = {
            first: 'Jane',
            last: 'Doe',
            org: { name: 'Acme' },
        };
        const result = interpolate('{{first}} {{last}} at {{org.name}}', ctx);
        expect(result).toBe('Jane Doe at Acme');
    });

    it('converts numbers to strings', () => {
        const result = interpolate('Count: {{count}}', { count: 42 });
        expect(result).toBe('Count: 42');
    });

    it('converts booleans to strings', () => {
        const result = interpolate('Active: {{active}}', { active: true });
        expect(result).toBe('Active: true');
    });

    it('handles whitespace in variable names', () => {
        const result = interpolate('{{ name }}', { name: 'Alice' });
        expect(result).toBe('Alice');
    });

    it('returns original text when no variables present', () => {
        const result = interpolate('No variables here', {});
        expect(result).toBe('No variables here');
    });
});

// ─── Frontmatter Parsing ────────────────────────────────────────────────────

describe('parseFrontmatter', () => {
    it('parses name, subject, and from from frontmatter', () => {
        const raw = `---
name: Test Template
subject: "Hello {{name}}"
from: "Team <team@test.com>"
---

Body content here.`;

        const { meta, body } = parseFrontmatter(raw);
        expect(meta.name).toBe('Test Template');
        expect(meta.subject).toBe('Hello {{name}}');
        expect(meta.from).toBe('Team <team@test.com>');
        expect(body).toBe('Body content here.');
    });

    it('handles missing frontmatter', () => {
        const raw = 'Just body text';
        const { meta, body } = parseFrontmatter(raw);
        expect(meta.name).toBe('');
        expect(body).toBe('Just body text');
    });

    it('handles single-quoted values', () => {
        const raw = `---
name: 'Single Quoted'
subject: 'Subject here'
from: 'sender@test.com'
---

Body.`;
        const { meta } = parseFrontmatter(raw);
        expect(meta.name).toBe('Single Quoted');
    });
});

// ─── Filesystem Loading ─────────────────────────────────────────────────────

describe('loadFromFilesystem', () => {
    it('loads an existing template file', () => {
        const loaded = loadFromFilesystem('invite');
        expect(loaded).not.toBeNull();
        expect(loaded!.slug).toBe('invite');
        expect(loaded!.meta.name).toBe('Team Member Invite');
        expect(loaded!.isOverride).toBe(false);
        expect(loaded!.body).toContain('invited to join');
    });

    it('returns null for non-existent template', () => {
        const loaded = loadFromFilesystem('nonexistent-template');
        expect(loaded).toBeNull();
    });
});

describe('listTemplateSlugs', () => {
    it('returns all template slugs from the filesystem', () => {
        const slugs = listTemplateSlugs();
        expect(slugs).toContain('invite');
        expect(slugs).toContain('welcome');
        expect(slugs).toContain('ticket-created');
        expect(slugs).toContain('ticket-resolved');
        expect(slugs).toContain('sla-breach');
        expect(slugs).toContain('escalation');
        expect(slugs).toContain('digest');
        expect(slugs.length).toBe(7);
    });
});

// ─── Template Loading with DB Override ──────────────────────────────────────

describe('loadTemplate', () => {
    it('returns filesystem template when no dbLookup provided', async () => {
        const loaded = await loadTemplate('invite');
        expect(loaded).not.toBeNull();
        expect(loaded!.isOverride).toBe(false);
    });

    it('returns filesystem template when dbLookup returns null', async () => {
        const dbLookup = vi.fn().mockResolvedValue(null);
        const loaded = await loadTemplate('invite', dbLookup);
        expect(loaded).not.toBeNull();
        expect(loaded!.isOverride).toBe(false);
        expect(dbLookup).toHaveBeenCalledWith('invite');
    });

    it('returns DB override when available', async () => {
        const dbLookup = vi.fn().mockResolvedValue({
            subject: 'Custom Subject',
            body: 'Custom body content',
        });
        const loaded = await loadTemplate('invite', dbLookup);
        expect(loaded).not.toBeNull();
        expect(loaded!.isOverride).toBe(true);
        expect(loaded!.meta.subject).toBe('Custom Subject');
        expect(loaded!.body).toBe('Custom body content');
    });

    it('returns null for nonexistent template with no override', async () => {
        const dbLookup = vi.fn().mockResolvedValue(null);
        const loaded = await loadTemplate('does-not-exist', dbLookup);
        expect(loaded).toBeNull();
    });
});

// ─── Markdown to HTML ───────────────────────────────────────────────────────

describe('markdownToHtml', () => {
    it('converts headings', () => {
        expect(markdownToHtml('# Title')).toContain('<h1>Title</h1>');
        expect(markdownToHtml('## Subtitle')).toContain('<h2>Subtitle</h2>');
        expect(markdownToHtml('### Section')).toContain('<h3>Section</h3>');
    });

    it('converts bold text', () => {
        expect(markdownToHtml('**bold**')).toContain('<strong>bold</strong>');
    });

    it('converts italic text', () => {
        expect(markdownToHtml('*italic*')).toContain('<em>italic</em>');
    });

    it('converts links', () => {
        const html = markdownToHtml('[Click](https://example.com)');
        expect(html).toContain('<a href="https://example.com">Click</a>');
    });

    it('converts unordered lists', () => {
        const html = markdownToHtml('- Item 1\n- Item 2');
        expect(html).toContain('<li>Item 1</li>');
        expect(html).toContain('<ul>');
    });

    it('converts tables', () => {
        const md = `| Field | Value |
|-------|-------|
| Name | Alice |`;
        const html = markdownToHtml(md);
        expect(html).toContain('<table>');
        expect(html).toContain('<th>Field</th>');
        expect(html).toContain('<td>Alice</td>');
    });
});

// ─── Markdown to Plain Text ─────────────────────────────────────────────────

describe('markdownToText', () => {
    it('strips bold markers', () => {
        expect(markdownToText('**bold**')).toBe('bold');
    });

    it('strips italic markers', () => {
        expect(markdownToText('*italic*')).toBe('italic');
    });

    it('converts links to text with URL', () => {
        expect(markdownToText('[Click](https://example.com)')).toBe('Click (https://example.com)');
    });

    it('strips heading markers', () => {
        expect(markdownToText('# Title')).toBe('Title');
        expect(markdownToText('## Subtitle')).toBe('Subtitle');
    });
});

// ─── Email Layout ───────────────────────────────────────────────────────────

describe('wrapInEmailLayout', () => {
    it('wraps content in HTML email structure', () => {
        const html = wrapInEmailLayout('<p>Hello</p>', 'Acme');
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<p>Hello</p>');
        expect(html).toContain('Sent by Acme');
    });

    it('defaults to Outpost when no org name given', () => {
        const html = wrapInEmailLayout('<p>Hello</p>');
        expect(html).toContain('Sent by Outpost');
    });
});

// ─── Full Render Pipeline ───────────────────────────────────────────────────

describe('renderTemplate', () => {
    const context: TemplateContext = {
        org: { name: 'TestCorp', email: 'support@testcorp.com' },
        member: { name: 'Alice', email: 'alice@testcorp.com', invitedBy: 'Bob', role: 'Engineer' },
        invite: { url: 'https://app.test/invite/abc', expiresIn: '7 days' },
    };

    it('renders the invite template with all formats', async () => {
        const result = await renderTemplate('invite', context);
        expect(result).not.toBeNull();
        expect(result!.slug).toBe('invite');
        expect(result!.subject).toContain('TestCorp');
        expect(result!.html).toContain('<!DOCTYPE html>');
        expect(result!.html).toContain('Alice');
        expect(result!.text).toContain('Alice');
        expect(result!.markdown).toContain('Alice');
    });

    it('returns null for nonexistent template', async () => {
        const result = await renderTemplate('nonexistent', {});
        expect(result).toBeNull();
    });

    it('uses DB override when available', async () => {
        const dbLookup = vi.fn().mockResolvedValue({
            subject: 'Custom: {{org.name}} invite',
            body: 'Hey {{member.name}}, join us!',
        });
        const result = await renderTemplate('invite', context, dbLookup);
        expect(result).not.toBeNull();
        expect(result!.subject).toBe('Custom: TestCorp invite');
        expect(result!.text).toContain('Hey Alice, join us!');
    });
});
