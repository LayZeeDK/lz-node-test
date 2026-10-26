import base, { SOURCE } from '../../stryker.base.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  mutate: ['packages/stryker-node-test-runner/src/**/*.ts'],
  tsconfigFile: 'packages/stryker-node-test-runner/tsconfig.stryker.json',
  lzStrykerNodeTest: { testFiles: ['packages/stryker-node-test-runner/test/**/*.test.ts'], nodeArgs: [SOURCE] },
};
