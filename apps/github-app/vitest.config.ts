import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@copilotkit/outpost-db': path.resolve(__dirname, '../../packages/db/src/index.ts'),
            '@copilotkit/outpost-queue': path.resolve(__dirname, '../../packages/queue/src/index.ts'),
            '@copilotkit/outpost-shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
            '@copilotkit/outpost-ai': path.resolve(__dirname, '../../packages/ai/src/index.ts'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts'],
        clearMocks: true,
    },
});
