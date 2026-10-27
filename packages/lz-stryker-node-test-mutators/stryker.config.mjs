import base, { source } from '../../stryker.base.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  // The synthetic sample is code that exists to be mutated by the production operators.
  mutate: [
    'packages/lz-stryker-node-test-mutators/src/**/*.ts',
    'packages/lz-stryker-node-test-mutators/test/synthetic/node-apis.ts',
  ],
  tsconfigFile: 'packages/lz-stryker-node-test-mutators/tsconfig.stryker.json',
  lzStrykerNodeTest: { testFiles: ['packages/lz-stryker-node-test-mutators/test/**/*.test.ts'], nodeArgs: [source] },
};
