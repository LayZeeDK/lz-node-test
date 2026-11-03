import base, { reportFiles, source, testCode } from '../../stryker.base.mjs';

export default await testCode({
  ...base,
  mutate: ['packages/stryker-node-test-mutators/test/**/*.test.ts'],
  tsconfigFile: 'packages/stryker-node-test-mutators/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/@layzee/stryker-node-test-mutators.test-code.json',
  ...reportFiles('@layzee/stryker-node-test-mutators.test-code'),
  lzNodeTest: { testFiles: ['packages/stryker-node-test-mutators/test/**/*.test.ts'], nodeArgs: [source] },
});
