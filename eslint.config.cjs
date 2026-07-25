/**
 * ESLint flat config.
 *
 * ESLint 9 looks for this file by default. Before it existed, linting depended on
 * ESLINT_USE_FLAT_CONFIG=false to opt back into `.eslintrc.cjs` — which only worked
 * where that variable happened to be set, so `pnpm lint` in a package directory, an
 * editor's ESLint integration, and any shell that is not POSIX all failed. Defining
 * the config here removes the variable from every one of those paths, and removes the
 * ESLint 10 deprecation cliff (eslintrc support is dropped there).
 *
 * The rule set is translated from the previous `.eslintrc.cjs` through FlatCompat so
 * behavior is unchanged: same parser, same two extends, same three rule overrides.
 * Verified by comparing problem counts before and after the migration.
 */

const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
});

module.exports = [
    {
        // Mirrors the old ignorePatterns. Flat config needs `**/` prefixes to match at
        // any depth — a bare `dist/` would only match the repo root.
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.next/**',
            '**/generated/**',
            '**/*.js',
            '**/*.cjs',
            '**/*.mjs',
        ],
    },
    ...compat.config({
        root: true,
        env: {
            node: true,
            es2022: true,
        },
        parser: '@typescript-eslint/parser',
        parserOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
        },
        plugins: ['@typescript-eslint'],
        extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
        rules: {
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/consistent-type-imports': 'warn',
        },
    }),
];
