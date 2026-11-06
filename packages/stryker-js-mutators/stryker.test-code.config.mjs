import base, { reportFiles, source, testCode } from '../../stryker.base.mjs';

export default await testCode({
  ...base,
  mutate: ['packages/stryker-js-mutators/test/**/*.test.ts'],
  tsconfigFile: 'packages/stryker-js-mutators/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/@layzee/stryker-js-mutators.test-code.json',
  ...reportFiles('@layzee/stryker-js-mutators.test-code'),
  lzNodeTest: { testFiles: ['packages/stryker-js-mutators/test/**/*.test.ts'], nodeArgs: [source] },
});
