import base, { reportFiles, source } from '../../stryker.base.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  mutate: ['tools/eslint-rules/*.ts', '!tools/eslint-rules/*.test.ts'],
  tsconfigFile: 'tools/eslint-rules/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/@lz-node-test/eslint-rules.src.json',
  ...reportFiles('@lz-node-test/eslint-rules.src'),
  lzNodeTest: { testFiles: ['tools/eslint-rules/*.test.ts'], nodeArgs: [source] },
};
