/**
 * Types for the template engine.
 */

/** Metadata parsed from template frontmatter. */
export interface TemplateMeta {
    name: string;
    subject: string;
    from: string;
}

/** Nested key-value context passed for variable interpolation. */
export interface TemplateContext {
    [key: string]: string | number | boolean | TemplateContext;
}

/** Result of rendering a template. */
export interface TemplateResult {
    slug: string;
    meta: TemplateMeta;
    subject: string;
    html: string;
    text: string;
    markdown: string;
}

/** A loaded template before rendering. */
export interface LoadedTemplate {
    slug: string;
    meta: TemplateMeta;
    body: string;
    isOverride: boolean;
}

/** Template list entry for the management UI. */
export interface TemplateListEntry {
    slug: string;
    name: string;
    subject: string;
    isOverride: boolean;
    updatedAt: string | null;
    editedBy: string | null;
}
