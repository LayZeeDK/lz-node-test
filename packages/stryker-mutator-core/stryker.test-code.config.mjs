import base, { reportFiles, source, testCode } from '../../stryker.base.mjs';

export default await testCode({
  ...base,
  mutate: ['packages/stryker-mutator-core/test/**/*.test.ts'],
  tsconfigFile: 'packages/stryker-mutator-core/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/@layzee/stryker-mutator-core.test-code.json',
  ...reportFiles('@layzee/stryker-mutator-core.test-code'),
  lzNodeTest: { testFiles: ['packages/stryker-mutator-core/test/**/*.test.ts'], nodeArgs: [source] },
});
