import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: false,
        include: ['*/src/**/*.test.ts', '*/src/**/__tests__/**/*.test.ts'],
    },
    resolve: {
        alias: {
            '@copilotkit/outpost/db': path.resolve(__dirname, 'db/src/index.ts'),
            '@copilotkit/outpost/ai': path.resolve(__dirname, 'ai/src/index.ts'),
            '@copilotkit/outpost/queue': path.resolve(__dirname, 'queue/src/index.ts'),
            '@copilotkit/outpost/shared': path.resolve(__dirname, 'shared/src/index.ts'),
        },
    },
});
