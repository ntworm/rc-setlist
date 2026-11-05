import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// ESLint flat config — gates P01, zero warnings since P04.
// Every rule this file registers is an `error`: the lint script runs with
// `--max-warnings 0`, so a warning fails the gate just like an error.
// `no-undef` and `no-unused-vars` already error in js.configs.recommended
// and the TS preset; we keep them.
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'vendor/**',
      'releases/**',
      'release-candidates/**',
      'scratch/**',
      'test-results/**',
      'docs/**',
      'bridge/**',
      'static/panel/qrcode.js',
      'src/ableton-sdk-public.d.ts',
    ],
  },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // scripts/**/*.ts is build/tooling, not part of the product `src/`
    // TypeScript project. Lint with non-type-aware recommended so the
    // parser does not need `parserOptions.project`. `no-undef` is off
    // because the JS-based eslint rule does not understand TypeScript
    // ambient namespaces (e.g. `NodeJS.*`); TypeScript itself enforces
    // the same check via `tsc --noEmit`.
    files: ['scripts/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['static/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Runtime modules loaded via <script> tags (P03 turns these into ES
        // module exports and removes the declaration).
        SetlistTransportRuntime: 'readonly',
        StageRuntime: 'readonly',
        RcSetlistI18n: 'readonly',
        RcSetlistControllerRuntime: 'readonly',
        calculateSongElapsedBeats: 'readonly',
        convertBeatsToSeconds: 'readonly',
        findActiveLyricLine: 'readonly',
        formatSecondsToLrcTime: 'readonly',
      },
    },
  },
  {
    files: [
      'tests/**/*.mjs',
      'static/**/*.test.mjs',
      'scripts/**/*.{mjs,ts}',
      'playwright.config.mjs',
    ],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['tests/ui/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['src/**/*.ts', 'static/**/*.js'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        { publicOnly: true, require: { FunctionDeclaration: true, ClassDeclaration: true } },
      ],
      'jsdoc/require-description': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/no-undefined-types': 'error',
    },
  },
  {
    // These are errors since P04: the warning count is zero, so there is
    // nothing left to soften. This block applies to every linted file (TS
    // or JS) and does not register any plugin.
    files: [
      'src/**/*.ts',
      'src/**/*.tsx',
      'static/**/*.js',
      'static/**/*.mjs',
      'tests/**/*.mjs',
      'scripts/**/*.{ts,mjs}',
      'playwright.config.mjs',
    ],
    rules: {
      'no-empty': 'error',
      'no-unused-vars': 'off',
      'no-useless-escape': 'error',
      'no-useless-assignment': 'error',
      'no-regex-spaces': 'error',
    },
  },
  {
    // The `@typescript-eslint/no-unsafe-*` / `no-explicit-any` /
    // `no-unused-vars` families are errors since P04: the SDK boundary in
    // `src/ableton-sdk-public.d.ts` keeps the SDK surface typed, so nothing
    // reaches these rules as `any` any more. Restricted to `.ts` because
    // those rules require `@typescript-eslint/parser` with
    // `parserOptions.project`; the JS-only surfaces cannot satisfy that.
    files: ['src/**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      // TypeScript already enforces type-correctness for missing identifiers;
      // the remaining `no-undef` complaints (e.g. ambient `NodeJS.*` types)
      // are bookkeeping the JS rule cannot express for TypeScript.
      'no-undef': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-duplicate-type-constituents': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      'no-control-regex': 'error',
      'no-useless-assignment': 'error',
      'no-case-declarations': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Structure ratchet: complexity 10, 500 lines per file and 60 lines per
    // function, counting every line. Today's debt lives in
    // eslint-suppressions.json, which only shrinks: after an improvement run
    // `npx eslint . --prune-suppressions`; never `--suppress-all` again.
    files: [
      'src/**/*.ts',
      'src/**/*.tsx',
      'static/**/*.js',
      'static/**/*.mjs',
      'tests/**/*.mjs',
      'scripts/**/*.{ts,mjs}',
      'playwright.config.mjs',
    ],
    rules: {
      complexity: ['error', { max: 10 }],
      'max-lines': ['error', { max: 500, skipBlankLines: false, skipComments: false }],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: false, skipComments: false }],
    },
  },
  prettier,
);
