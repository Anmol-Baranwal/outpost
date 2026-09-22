import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // No `globals`: every test imports what it uses, and the app's tsconfig
        // does not include vitest's global types, so relying on them would
        // typecheck only inside the test run.
        environment: 'node',
        include: ['src/**/*.test.ts'],
        clearMocks: true,
        restoreMocks: true,
    },
});
