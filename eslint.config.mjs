// @ts-check
import js from '@eslint/js';
import tsplugin from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

/**
 * ESLint flat config — the ESLint 9 replacement for the repo's `.eslintrc.cjs`.
 *
 * ESLint 9 will not read `.eslintrc.*` without `ESLINT_USE_FLAT_CONFIG=false`,
 * and that env var does not survive turbo's environment sanitization. So every
 * package running `eslint src/` failed with "couldn't find an eslint.config
 * file", the CI job named "Lint, Typecheck & Test" ran no lint step, and the
 * repo has been unlinted since the ESLint 9 bump. See #141.
 *
 * Rule set is carried over from `.eslintrc.cjs` unchanged, so this migration is
 * about the config FORMAT and not about tightening anything: the same three
 * repo-specific rules on top of the same two recommended sets.
 *
 * `@eslint/js` is pinned to the same major as `eslint` itself for that reason.
 * On `^10` against eslint 9 it supplies v10's recommended set — 64 rules rather
 * than 61, adding `preserve-caught-error`, `no-useless-assignment` and
 * `no-unassigned-vars` — which is a rule change smuggled in under a format
 * migration, and a latent hard failure the first time that set names a rule
 * eslint 9 does not ship.
 *
 * `apps/web` is deliberately untouched. It runs `next lint` against its own
 * `.eslintrc.cjs`, which supplies the `react-hooks` and `@next/next` plugins
 * this config does not carry — linting it here instead would report
 * `react-hooks/exhaustive-deps` as an unknown rule wherever the app disables it
 * inline. `next lint` is deprecated in Next 15 and removed in 16, so that
 * migration is its own change with its own verification.
 */
export default [
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.next/**',
            '**/coverage/**',
            // Agent worktrees carry full copies of the repo, including their own
            // configs. Linting them lints the same files many times over and
            // reports on branches nobody is working from.
            '.claude/**',
            // apps/web lints itself via `next lint`; see the note above.
            'apps/web/**',
            // Config and script files that were outside the old config's reach
            // too — `.eslintrc.cjs` ignored `*.js` wholesale.
            '**/*.js',
            '**/*.cjs',
            '**/*.mjs',
        ],
    },
    js.configs.recommended,
    ...tsplugin.configs['flat/recommended'],
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parser: tsparser,
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                // The old config got these from `env: { node: true, es2022: true }`,
                // which flat config replaces with explicit globals. Only the ones
                // this codebase actually uses are listed, so a typo in a browser
                // global still gets caught in Node code.
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                AbortController: 'readonly',
                AbortSignal: 'readonly',
                DOMException: 'readonly',
                fetch: 'readonly',
                Response: 'readonly',
                Request: 'readonly',
                Headers: 'readonly',
                ReadableStream: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                setImmediate: 'readonly',
                queueMicrotask: 'readonly',
                structuredClone: 'readonly',
                crypto: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                module: 'readonly',
                require: 'readonly',
                exports: 'writable',
                global: 'readonly',
                globalThis: 'readonly',
            },
        },
        plugins: { '@typescript-eslint': tsplugin },
        rules: {
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/consistent-type-imports': 'warn',
        },
    },
    {
        // Test files mock external shapes — Prisma clients, SDK responses — where
        // an accurate type is large, brittle, and buys nothing the assertions do
        // not already pin. `no-explicit-any` earns its `error` in production code
        // and does not here.
        files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**/*.ts', '**/__tests__/**/*.tsx'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },
];
