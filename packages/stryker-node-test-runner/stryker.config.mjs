import base, { reportFiles, source } from '../../stryker.base.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  mutate: ['packages/stryker-node-test-runner/src/**/*.ts'],
  tsconfigFile: 'packages/stryker-node-test-runner/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/stryker-node-test-runner.src.json',
  ...reportFiles('stryker-node-test-runner.src'),
  lzStrykerNodeTest: { testFiles: ['packages/stryker-node-test-runner/test/**/*.test.ts'], nodeArgs: [source] },
};
