import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

function getDatabaseUrl(): string | undefined {
    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) return undefined;

    const limit = process.env.DB_CONNECTION_LIMIT ?? '5';
    if (baseUrl.includes('connection_limit=')) return baseUrl;

    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}connection_limit=${limit}`;
}

const dbUrl = getDatabaseUrl();

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
        ...(dbUrl ? { datasources: { db: { url: dbUrl } } } : {}),
    });

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

export { PrismaClient };
export * from '@prisma/client';
