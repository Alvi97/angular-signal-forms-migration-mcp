// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `verify/` is a separate workspace with its own tsconfig and its own compile check
    // (npm run verify:recipes). Linting it from here would need it in this project's
    // program, which would drag real Angular into the published package's typecheck.
    // `scripts/` are plain node build tools, outside the typed program; `verify/` is a
    // separate workspace with its own tsconfig and its own compile check.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'verify/**', 'scripts/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md: no `any`, no non-null assertions.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // CLAUDE.md: explicit return types on exported functions.
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      // CLAUDE.md: stdout is the MCP stdio channel and must stay clean.
      'no-console': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Tests may lean on non-null narrowing of fixtures for readability.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
