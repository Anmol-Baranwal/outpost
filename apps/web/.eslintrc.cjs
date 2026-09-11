/** @type {import('eslint').Linter.Config} */
module.exports = {
    // `root: true` stops the eslintrc cascade here.
    //
    // Without it this config inherited the repo-root `.eslintrc.cjs`, which is
    // where `argsIgnorePattern: '^_'` and `consistent-type-imports` came from —
    // so removing that file in the flat-config migration silently changed how
    // this app lints, and `_request` / `_ticket` started reporting as unused.
    // The rules are restated below rather than inherited, and the boundary is
    // explicit so ESLint no longer walks above the repo looking for a parent
    // config on a developer's machine.
    root: true,
    extends: ['next/core-web-vitals', 'next/typescript'],
    rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/consistent-type-imports': 'warn',
    },
};
