import base, { SOURCE } from '../../stryker.base.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  mutate: ['packages/lz-node-test/src/**/*.ts'],
  tsconfigFile: 'packages/lz-node-test/tsconfig.stryker.json',
  lzNodeTest: { testFiles: ['packages/lz-node-test/test/**/*.test.ts'], nodeArgs: [SOURCE] },
};
