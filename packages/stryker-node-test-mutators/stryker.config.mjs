import base, { SOURCE } from '../../stryker.base.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  mutate: ['packages/stryker-node-test-mutators/src/**/*.ts'],
  tsconfigFile: 'packages/stryker-node-test-mutators/tsconfig.stryker.json',
  lzNodeTest: { testFiles: ['packages/stryker-node-test-mutators/test/**/*.test.ts'], nodeArgs: [SOURCE] },
};
