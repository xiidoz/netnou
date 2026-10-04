import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';

export default defineConfig([
  globalIgnores(['public/vendor/', 'data/', 'node_modules/', 'coverage/', '.local/']),

  js.configs.recommended,
  {
    // Only rules that catch mistakes; formatting is left to .editorconfig.
    rules: {
      'array-callback-return': 'error',
      eqeqeq: 'error',
      'no-throw-literal': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  {
    files: ['server/**', 'test/**', 'tools/**', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // The page: ES modules, with Leaflet loaded by a classic script before them.
    files: ['public/*.js', 'public/locales/**'],
    ignores: ['public/sw.js'],
    languageOptions: { globals: { ...globals.browser, L: 'readonly' } },
  },
  {
    // Registered as a classic script, so it may not use import or export.
    files: ['public/sw.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
  },
]);
