import base, { SOURCE } from '../../stryker.base.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  // The synthetic sample is code that exists to be mutated by the production operators.
  mutate: [
    'packages/stryker-node-test-mutators/src/**/*.ts',
    'packages/stryker-node-test-mutators/test/synthetic/node-apis.ts',
  ],
  tsconfigFile: 'packages/stryker-node-test-mutators/tsconfig.stryker.json',
  lzStrykerNodeTest: { testFiles: ['packages/stryker-node-test-mutators/test/**/*.test.ts'], nodeArgs: [SOURCE] },
};
