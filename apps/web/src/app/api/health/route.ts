import { NextResponse } from 'next/server';

const startedAt = Date.now();

export async function GET() {
    return NextResponse.json({
        status: 'ok',
        service: 'web',
        version: process.env.npm_package_version ?? '0.1.0',
        uptime: Math.floor((Date.now() - startedAt) / 1000),
    });
}
