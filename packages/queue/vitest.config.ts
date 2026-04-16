import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: false,
        include: ['src/__tests__/**/*.test.ts'],
    },
    resolve: {
        alias: {
            // Point workspace deps to their source so vite can resolve them
            // (they may not be built yet). Tests mock these anyway.
            '@copilotkit/outpost-ai': path.resolve(__dirname, '../ai/src/index.ts'),
            '@copilotkit/outpost-db': path.resolve(__dirname, '../db/src/index.ts'),
            '@copilotkit/outpost-shared': path.resolve(__dirname, '../shared/src/index.ts'),
        },
    },
});
