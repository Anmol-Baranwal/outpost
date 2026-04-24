import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/__tests__/setup.ts'],
        include: ['src/__tests__/**/*.test.{ts,tsx}'],
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@copilotkit/outpost/db': path.resolve(__dirname, '../../packages/outpost/db/src'),
            '@copilotkit/outpost/shared/server': path.resolve(__dirname, '../../packages/outpost/shared/src/server'),
            '@copilotkit/outpost/shared': path.resolve(__dirname, '../../packages/outpost/shared/src'),
            '@copilotkit/outpost/ai': path.resolve(__dirname, '../../packages/outpost/ai/src'),
        },
    },
});
