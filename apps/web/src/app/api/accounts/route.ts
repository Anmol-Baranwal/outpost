import { NextResponse } from 'next/server';

export async function GET() {
    // TODO: Implement account listing with pagination
    return NextResponse.json({
        accounts: [],
        total: 0,
        page: 1,
        pageSize: 25,
    });
}

export async function POST(request: Request) {
    const body = await request.json();

    // TODO: Create account in database
    return NextResponse.json(
        { message: 'Account creation not yet implemented', data: body },
        { status: 501 },
    );
}
