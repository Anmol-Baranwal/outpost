/**
 * ESLint flat config for every workspace except `apps/web`.
 *
 * ESLint 9 looks for this file by default. Before it existed, linting depended on
 * ESLINT_USE_FLAT_CONFIG=false to opt back into `.eslintrc.cjs` — which only worked where
 * that variable happened to be set, so `pnpm lint` inside a package, an editor's ESLint
 * integration, and any non-POSIX shell all failed. Defining the config here removes the
 * variable from all of those paths.
 *
 * Translated from the former root `.eslintrc.cjs` via FlatCompat: same parser, same two
 * extends, same three rule overrides. The ignore list is NOT a literal copy — see below.
 *
 * `apps/web` is deliberately excluded. It keeps its own `.eslintrc.cjs` (Next.js rules,
 * including react-hooks) and is linted by `next lint` through its own package script. If
 * this config applied there, it would shadow that eslintrc and ESLint would fail with
 * "Definition for rule 'react-hooks/exhaustive-deps' was not found", since the Next and
 * react-hooks plugins are not loaded here. Migrating web is still outstanding: `next lint`
 * is removed in Next 16, and until then eslintrc lives on in that one package.
 */

const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
});

module.exports = [
    {
        // The former eslintrc ignored: node_modules/, dist/, .next/, *.js.
        // Flat config needs `**/` to match at any depth — a bare `dist/` matches only the
        // repo root. Three entries are additions, not translations:
        //   - apps/web/**       — owned by next lint + apps/web/.eslintrc.cjs (see above)
        //   - **/generated/**   — Prisma client output, not hand-written source
        //   - **/*.cjs, **/*.mjs — config files (this one, postcss.config.cjs); the old
        //                         config ignored only `*.js`, so these were nominally in
        //                         scope. Excluding them is a deliberate scope reduction.
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.next/**',
            '**/generated/**',
            '**/*.js',
            '**/*.cjs',
            '**/*.mjs',
            'apps/web/**',
        ],
    },
    ...compat.config({
        // NOTE: no `root: true` here — that key is eslintrc-only and FlatCompat drops it
        // silently. Flat config has no cascade, so there is nothing to root.
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
