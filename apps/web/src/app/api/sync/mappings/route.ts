import { NextRequest, NextResponse } from 'next/server';
import { MOCK_MAPPING_CONFIG } from '@/lib/mock-sync';

// Mutable config for the lifetime of the process.
let currentConfig = { ...MOCK_MAPPING_CONFIG };

/**
 * GET /api/sync/mappings
 *
 * Returns the current mapping configuration for all plugins.
 */
export async function GET() {
    return NextResponse.json(currentConfig);
}

/**
 * PUT /api/sync/mappings
 *
 * Update the mapping configuration.
 * Body: MappingConfig
 */
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();

        // Basic validation
        if (!body.statusMappings || !body.priorityMappings) {
            return NextResponse.json(
                { error: 'statusMappings and priorityMappings are required' },
                { status: 400 },
            );
        }

        currentConfig = body;
        return NextResponse.json({ success: true, config: currentConfig });
    } catch {
        return NextResponse.json(
            { error: 'Invalid request body' },
            { status: 400 },
        );
    }
}
