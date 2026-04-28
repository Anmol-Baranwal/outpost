import { NextResponse } from 'next/server';
import { prisma } from '@copilotkit/outpost/db';

const startedAt = Date.now();

export async function GET() {
    let database: 'connected' | 'unreachable' = 'unreachable';

    try {
        let timer: ReturnType<typeof setTimeout>;
        await Promise.race([
            prisma.$queryRawUnsafe('SELECT 1').then((r) => { clearTimeout(timer); return r; }),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Database timeout')), 3000);
            }),
        ]);
        database = 'connected';
    } catch {
        return NextResponse.json(
            {
                status: 'degraded',
                service: 'web',
                version: process.env.npm_package_version ?? '0.1.0',
                uptime: Math.floor((Date.now() - startedAt) / 1000),
                database: 'unreachable',
                error: 'Database unreachable',
            },
            { status: 503 },
        );
    }

    return NextResponse.json({
        status: 'ok',
        service: 'web',
        version: process.env.npm_package_version ?? '0.1.0',
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        database,
    });
}
