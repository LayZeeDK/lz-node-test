import base, {
  concurrency,
  gbPerUnitWithChildProcesses,
  ignorePatternsKeepingE2e,
  reportFiles,
  source,
  testCode,
} from '../stryker.base.mjs';

export default await testCode({
  ...base,
  concurrency: concurrency(gbPerUnitWithChildProcesses),
  mutate: ['e2e/test/unit/*.test.ts'],
  ignorePatterns: ignorePatternsKeepingE2e,
  tsconfigFile: 'e2e/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/e2e.test-code.json',
  ...reportFiles('e2e.test-code'),
  lzNodeTest: { testFiles: ['e2e/test/unit/*.test.ts'], nodeArgs: [source] },
});
