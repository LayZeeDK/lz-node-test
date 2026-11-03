import base, { reportFiles, source, testCode } from '../../stryker.base.mjs';

export default await testCode({
  ...base,
  mutate: ['packages/stryker-node-test-runner/test/**/*.test.ts'],
  tsconfigFile: 'packages/stryker-node-test-runner/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/@layzee/stryker-node-test-runner.test-code.json',
  ...reportFiles('@layzee/stryker-node-test-runner.test-code'),
  lzNodeTest: { testFiles: ['packages/stryker-node-test-runner/test/**/*.test.ts'], nodeArgs: [source] },
});
