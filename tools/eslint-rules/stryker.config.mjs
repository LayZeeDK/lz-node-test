import base, { SOURCE } from '../../stryker.base.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  mutate: [
    'tools/eslint-rules/*.ts',
    '!tools/eslint-rules/*.test.ts',
    // Only the Nx loader reads it, and ESLint fails on a configured rule it cannot find.
    '!tools/eslint-rules/index.ts',
  ],
  tsconfigFile: 'tools/eslint-rules/tsconfig.stryker.json',
  lzStrykerNodeTest: { testFiles: ['tools/eslint-rules/*.test.ts'], nodeArgs: [SOURCE] },
};
