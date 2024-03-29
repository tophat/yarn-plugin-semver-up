module.exports = {
    root: true,
    extends: ['@tophat/eslint-config/base', '@tophat/eslint-config/jest'],
    parserOptions: {
        project: ['./tsconfig.lint.json'],
        tsconfigRootDir: __dirname,
    },
    rules: {
        'prettier/prettier': [
            'error',
            {
                printWidth: 100,
                tabWidth: 4,
                semi: false,
                trailingComma: 'all' /* Reduces git diff. */,
                singleQuote: true,
                arrowParens: 'always', // Reduces character diff when adding Typescript types.
            },
        ],
        '@typescript-eslint/no-non-null-assertion': 'off',
        'no-empty': ['error', { allowEmptyCatch: true }],
        'import/order': [
            'error',
            {
                alphabetize: { order: 'asc' },
                'newlines-between': 'always',
                groups: [
                    'unknown',
                    'builtin',
                    'external',
                    'internal',
                    'parent',
                    'sibling',
                    'index',
                ],
            },
        ],
    },
    ignorePatterns: ['**/.*'],
}
