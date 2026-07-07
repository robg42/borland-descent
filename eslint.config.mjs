import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // .claude holds agent worktrees (full repo copies) — linting them would
    // double-lint the tree and confuse the parser's tsconfig-root detection.
    ignores: ['dist', '**/dist', 'coverage', '**/*.config.*', '.claude'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        // Pin the root: sibling worktrees under .claude/ otherwise present a
        // second candidate and typescript-eslint refuses to guess.
        tsconfigRootDir: import.meta.dirname,
      },
    },
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
  {
    // AudioWorklet processors run in AudioWorkletGlobalScope (not the DOM); give
    // ESLint their globals. Kept as plain .js so Vite bundles them verbatim.
    files: ['**/*.worklet.js'],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
        currentTime: 'readonly',
        currentFrame: 'readonly',
      },
    },
  },
);
