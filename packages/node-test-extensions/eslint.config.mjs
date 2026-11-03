import baseConfig, { noPrivateModifier, noTypeAssertions, readonlyMembers } from '../../eslint.config.mjs';

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
    // The modifier tests run lzTestEach.only and lzTestFor.only on purpose, so only the .only selector goes.
    files: ['test/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...noTypeAssertions, ...noPrivateModifier, ...readonlyMembers] },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
