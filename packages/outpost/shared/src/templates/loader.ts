/**
 * Template loader.
 *
 * Loads a template by slug. Checks for a DB override first (via the
 * TemplateOverride model), falling back to the filesystem default
 * in the templates/ directory at the repo root.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { LoadedTemplate, TemplateMeta } from './types.js';

/** Parse frontmatter from a Markdown template string. */
export function parseFrontmatter(raw: string): { meta: TemplateMeta; body: string } {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
        return {
            meta: { name: '', subject: '', from: '' },
            body: raw.trim(),
        };
    }

    const frontmatterBlock = match[1];
    const body = match[2].trim();

    const meta: Record<string, string> = {};
    for (const line of frontmatterBlock.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        meta[key] = value;
    }

    return {
        meta: {
            name: meta.name || '',
            subject: meta.subject || '',
            from: meta.from || '',
        },
        body,
    };
}

/** Resolve the templates directory. Walks up from CWD looking for it. */
function findTemplatesDir(): string {
    // In production, templates are at the repo root /templates
    // We try a few known locations
    const candidates = [
        join(process.cwd(), 'templates'),
        join(process.cwd(), '..', 'templates'),
        join(process.cwd(), '..', '..', 'templates'),
        join(process.cwd(), '..', '..', '..', 'templates'),
    ];

    for (const dir of candidates) {
        try {
            readdirSync(dir);
            return dir;
        } catch {
            // not found, try next
        }
    }

    return join(process.cwd(), 'templates');
}

/** Load a template from the filesystem. Returns null if not found. */
export function loadFromFilesystem(slug: string): LoadedTemplate | null {
    const dir = findTemplatesDir();
    const filePath = join(dir, `${slug}.md`);

    try {
        const raw = readFileSync(filePath, 'utf-8');
        const { meta, body } = parseFrontmatter(raw);
        return { slug, meta, body, isOverride: false };
    } catch {
        return null;
    }
}

/**
 * Load a template by slug with optional DB override lookup.
 *
 * The dbLookup function is injected so the loader doesn't depend on Prisma
 * directly — callers pass in the DB query.
 */
export async function loadTemplate(
    slug: string,
    dbLookup?: (slug: string) => Promise<{ subject: string; body: string } | null>,
): Promise<LoadedTemplate | null> {
    // Check DB override first
    if (dbLookup) {
        const override = await dbLookup(slug);
        if (override) {
            const { meta, body: _fsBody } = (() => {
                const fs = loadFromFilesystem(slug);
                if (fs) return { meta: fs.meta, body: fs.body };
                return { meta: { name: slug, subject: '', from: '' }, body: '' };
            })();

            return {
                slug,
                meta: { ...meta, subject: override.subject },
                body: override.body,
                isOverride: true,
            };
        }
    }

    // Fall back to filesystem
    return loadFromFilesystem(slug);
}

/** List all available template slugs from the filesystem. */
export function listTemplateSlugs(): string[] {
    const dir = findTemplatesDir();
    try {
        return readdirSync(dir)
            .filter((f) => f.endsWith('.md'))
            .map((f) => f.replace(/\.md$/, ''));
    } catch {
        return [];
    }
}
