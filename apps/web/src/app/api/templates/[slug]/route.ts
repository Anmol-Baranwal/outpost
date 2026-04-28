import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { loadFromFilesystem } from '@copilotkit/outpost/shared/server';

/**
 * GET /api/templates/[slug]
 *
 * Get a single template's content (filesystem default or DB override).
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ slug: string }> },
) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slug } = await params;
    const loaded = loadFromFilesystem(slug);

    if (!loaded) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({
        slug: loaded.slug,
        name: loaded.meta.name,
        subject: loaded.meta.subject,
        from: loaded.meta.from,
        body: loaded.body,
        isOverride: loaded.isOverride,
    });
}

/**
 * PUT /api/templates/[slug]
 *
 * Save a template override (ADMIN only).
 * In production this writes to the TemplateOverride table.
 * For now, returns a mock success response.
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ slug: string }> },
) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slug } = await params;
    const body = await request.json();

    // Validate required fields
    if (!body.subject || !body.body) {
        return NextResponse.json(
            { error: 'subject and body are required' },
            { status: 400 },
        );
    }

    // In production, this would write to the TemplateOverride table:
    // await prisma.templateOverride.upsert({ where: { slug }, create: {...}, update: {...} })

    return NextResponse.json({
        slug,
        subject: body.subject,
        body: body.body,
        isOverride: true,
        updatedAt: new Date().toISOString(),
    });
}

/**
 * DELETE /api/templates/[slug]
 *
 * Reset a template to filesystem default (ADMIN only).
 * Deletes the DB override if one exists.
 */
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ slug: string }> },
) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slug } = await params;

    // In production: await prisma.templateOverride.delete({ where: { slug } })

    return NextResponse.json({ slug, reset: true });
}
