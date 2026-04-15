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
            '@outpost/db': path.resolve(__dirname, '../db/src/index.ts'),
            '@outpost/shared': path.resolve(__dirname, '../shared/src/index.ts'),
        },
    },
});
