import base, { reportFiles, source, testCode } from '../../stryker.base.mjs';

export default await testCode({
  ...base,
  mutate: ['packages/node-test-extensions/test/**/*.test.ts'],
  tsconfigFile: 'packages/node-test-extensions/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/@layzee/node-test-extensions.test-code.json',
  ...reportFiles('@layzee/node-test-extensions.test-code'),
  lzNodeTest: { testFiles: ['packages/node-test-extensions/test/**/*.test.ts'], nodeArgs: [source] },
});
