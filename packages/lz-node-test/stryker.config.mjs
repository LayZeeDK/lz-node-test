import base, { reportFiles, source } from '../../stryker.base.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  mutate: ['packages/lz-node-test/src/**/*.ts'],
  tsconfigFile: 'packages/lz-node-test/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/lz-node-test.src.json',
  ...reportFiles('lz-node-test.src'),
  lzStrykerNodeTest: { testFiles: ['packages/lz-node-test/test/**/*.test.ts'], nodeArgs: [source] },
};
