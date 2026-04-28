import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
    listTemplateSlugs,
    loadFromFilesystem,
} from '@copilotkit/outpost/shared/server';
import type { TemplateListEntry } from '@copilotkit/outpost/shared/server';

/**
 * GET /api/templates
 *
 * List all templates. Merges filesystem defaults with DB overrides.
 * In this mock implementation, we only return filesystem templates
 * (DB overrides would be merged in production with Prisma).
 */
export async function GET(_request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const slugs = listTemplateSlugs();

    const entries: TemplateListEntry[] = slugs.map((slug) => {
        const loaded = loadFromFilesystem(slug);
        return {
            slug,
            name: loaded?.meta.name || slug,
            subject: loaded?.meta.subject || '',
            isOverride: false,
            updatedAt: null,
            editedBy: null,
        };
    });

    return NextResponse.json(entries);
}
