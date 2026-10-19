import js from '@eslint/js';
import ts from 'typescript-eslint';

export default ts.config(
  { ignores: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/release/**', '**/.wrangler/**', 'test-results/**', 'playwright-report/**'] },
  { files: ['**/*.ts', '**/*.tsx'], extends: [js.configs.recommended, ...ts.configs.recommended], rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
  } },
);