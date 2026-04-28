import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

function getDatabaseUrl(): string | undefined {
    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) return undefined;

    const limit = process.env.DB_CONNECTION_LIMIT ?? '5';

    try {
        const url = new URL(baseUrl);
        if (!url.searchParams.has('connection_limit')) {
            url.searchParams.set('connection_limit', limit);
        }
        return url.toString();
    } catch {
        // If URL parsing fails (e.g. non-standard format), append as query param
        const separator = baseUrl.includes('?') ? '&' : '?';
        if (!baseUrl.includes('connection_limit=')) {
            return `${baseUrl}${separator}connection_limit=${limit}`;
        }
        return baseUrl;
    }
}

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        datasources: {
            db: {
                url: getDatabaseUrl(),
            },
        },
    });

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

export { PrismaClient };
export * from '@prisma/client';
