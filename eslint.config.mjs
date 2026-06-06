import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', '**/dist', 'coverage', '**/*.config.*'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Golden rule: the engine is framework-agnostic. It must never import React
    // or Vite-specific modules — the boundary is enforced here as well as by the
    // engine package.json (which lists only tone/three/zod).
    files: ['packages/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: 'packages/engine is framework-agnostic — no React here.',
            },
            {
              group: ['vite', 'vite/*', '@vitejs/*'],
              message: 'packages/engine must not import Vite-specific modules.',
            },
          ],
        },
      ],
    },
  },
);
