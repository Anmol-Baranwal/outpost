import { NextResponse } from 'next/server';
import { MOCK_CATEGORIES } from '@/lib/mock-docs';

/**
 * GET /api/docs/categories
 *
 * List all documentation categories with article counts.
 */
export async function GET() {
    return NextResponse.json({ categories: MOCK_CATEGORIES });
}
