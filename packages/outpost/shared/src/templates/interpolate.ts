/**
 * Template variable interpolation.
 *
 * Supports:
 * - Simple: {{name}}
 * - Nested: {{org.name}}, {{member.email}}
 * - Missing variables are replaced with empty string
 */
import type { TemplateContext } from './types.js';

/**
 * Resolve a dotted path against a nested context object.
 * Returns the string value or empty string if not found.
 */
function resolve(path: string, context: TemplateContext): string {
    const parts = path.split('.');
    let current: unknown = context;

    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') {
            return '';
        }
        current = (current as Record<string, unknown>)[part];
    }

    if (current === null || current === undefined) {
        return '';
    }

    return String(current);
}

/**
 * Replace all {{variable}} patterns in the input string with values from context.
 */
export function interpolate(template: string, context: TemplateContext): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
        return resolve(path.trim(), context);
    });
}
