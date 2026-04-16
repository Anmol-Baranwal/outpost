import { NextRequest, NextResponse } from 'next/server';
import { renderTemplate } from '@copilotkit/outpost/shared/server';
import type { TemplateContext } from '@copilotkit/outpost/shared/server';

/** Sample data used for template previews. */
const SAMPLE_CONTEXT: TemplateContext = {
    org: { name: 'Acme Corp', email: 'support@acme.com' },
    member: { name: 'Jane Smith', email: 'jane@acme.com', invitedBy: 'John Admin', role: 'Engineer' },
    customer: { name: 'Alex Customer', email: 'alex@example.com' },
    invite: { url: 'https://app.outpost.dev/invite/sample-token', expiresIn: '7 days' },
    app: { url: 'https://app.outpost.dev' },
    ticket: {
        displayId: 'TKT-0042',
        title: 'Cannot connect to API endpoint',
        url: 'https://app.outpost.dev/tickets/tkt-0042',
        priority: 'HIGH',
        assignee: 'Jane Smith',
        resolution: 'The API endpoint was updated to v2. Updated the SDK configuration to point to the new URL.',
    },
    sla: { target: '4 hours', elapsed: '6 hours 23 minutes' },
    escalation: { by: 'System', from: 'Jane Smith', to: 'John Admin', reason: 'SLA breach and no response in 6 hours' },
    digest: {
        date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        openTickets: '12',
        resolvedToday: '5',
        breachedSla: '1',
        assignedToYou: '3',
        awaitingResponse: '2',
    },
};

/**
 * POST /api/templates/[slug]/preview
 *
 * Render a template with sample data and return the HTML.
 * Optionally accepts a custom context in the request body.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ slug: string }> },
) {
    const { slug } = await params;

    let context = SAMPLE_CONTEXT;
    try {
        const body = await request.json();
        if (body.context) {
            context = { ...SAMPLE_CONTEXT, ...body.context };
        }
    } catch {
        // Use default sample context
    }

    const result = await renderTemplate(slug, context);
    if (!result) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({
        subject: result.subject,
        html: result.html,
        text: result.text,
        markdown: result.markdown,
    });
}
