import base, { source } from '../../stryker.base.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  mutate: ['tools/eslint-rules/*.ts', '!tools/eslint-rules/*.test.ts'],
  tsconfigFile: 'tools/eslint-rules/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/eslint-rules.src.json',
  lzStrykerNodeTest: { testFiles: ['tools/eslint-rules/*.test.ts'], nodeArgs: [source] },
};
