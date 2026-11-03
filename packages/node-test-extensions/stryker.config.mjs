import base, { reportFiles, source } from '../../stryker.base.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  mutate: ['packages/node-test-extensions/src/**/*.ts'],
  tsconfigFile: 'packages/node-test-extensions/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/lz-node-test.src.json',
  ...reportFiles('lz-node-test.src'),
  lzNodeTest: { testFiles: ['packages/node-test-extensions/test/**/*.test.ts'], nodeArgs: [source] },
};
