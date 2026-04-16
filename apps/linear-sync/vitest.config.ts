import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@copilotkit/outpost/db': path.resolve(__dirname, '../../packages/outpost/db/src/index.ts'),
            '@copilotkit/outpost/queue': path.resolve(__dirname, '../../packages/outpost/queue/src/index.ts'),
            '@copilotkit/outpost/shared': path.resolve(__dirname, '../../packages/outpost/shared/src/index.ts'),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts'],
        clearMocks: true,
    },
});
