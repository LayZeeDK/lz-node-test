import base, { e2eIgnorePatterns, reportFiles, source, testCode } from '../stryker.base.mjs';

export default await testCode({
  ...base,
  mutate: ['e2e/test/unit/*.test.ts'],
  ignorePatterns: e2eIgnorePatterns,
  tsconfigFile: 'e2e/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/e2e.test-code.json',
  ...reportFiles('e2e.test-code'),
  lzNodeTest: { testFiles: ['e2e/test/unit/*.test.ts'], nodeArgs: [source] },
});
