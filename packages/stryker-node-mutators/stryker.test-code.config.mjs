import base, { reportFiles, source, testCode } from '../../stryker.base.mjs';

export default await testCode({
  ...base,
  mutate: ['packages/stryker-node-mutators/test/**/*.test.ts'],
  tsconfigFile: 'packages/stryker-node-mutators/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/@layzee/stryker-node-mutators.test-code.json',
  ...reportFiles('@layzee/stryker-node-mutators.test-code'),
  lzNodeTest: { testFiles: ['packages/stryker-node-mutators/test/**/*.test.ts'], nodeArgs: [source] },
});
