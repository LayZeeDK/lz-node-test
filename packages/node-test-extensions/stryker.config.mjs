import base, { reportFiles, source } from '../../stryker.base.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  mutate: ['packages/node-test-extensions/src/**/*.ts'],
  tsconfigFile: 'packages/node-test-extensions/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/@layzee/node-test-extensions.src.json',
  ...reportFiles('@layzee/node-test-extensions.src'),
  lzNodeTest: { testFiles: ['packages/node-test-extensions/test/**/*.test.ts'], nodeArgs: [source] },
};
