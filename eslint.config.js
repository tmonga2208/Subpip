import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'functions/', 'web/', 'node_modules/', '.superpowers/'] },
  js.configs.recommended,
  { rules: { 'no-unused-vars': ['error', { caughtErrors: 'none' }] } },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions }
    }
  },
  {
    files: ['build.mjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node }
  },
  {
    files: ['tests/**/*.js'],
    // Callbacks passed to page/worker evaluate run in the browser or extension
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.webextensions } }
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node }
  }
];
