import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
  {
    // The modifier tests run lzTestEach.only on purpose.
    files: ['test/integration/modified.test.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
