import base, { reportFiles, source } from '../../stryker.base.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  mutate: ['packages/stryker-mutator-core/src/**/*.ts'],
  tsconfigFile: 'packages/stryker-mutator-core/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/@layzee/stryker-mutator-core.src.json',
  ...reportFiles('@layzee/stryker-mutator-core.src'),
  lzNodeTest: { testFiles: ['packages/stryker-mutator-core/test/**/*.test.ts'], nodeArgs: [source] },
};
