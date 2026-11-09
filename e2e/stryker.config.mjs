import base, {
  concurrency,
  gbPerUnitWithChildProcesses,
  ignorePatternsKeepingE2e,
  production,
  reportFiles,
  source,
} from '../stryker.base.mjs';

export default await production(
  {
    ...base,
    concurrency: concurrency(gbPerUnitWithChildProcesses),
    mutate: ['e2e/src/**/*.ts'],
    ignorePatterns: ignorePatternsKeepingE2e,
    tsconfigFile: 'e2e/tsconfig.stryker.json',
    incrementalFile: 'reports/stryker-incremental/e2e.src.json',
    ...reportFiles('e2e.src'),
    lzNodeTest: { testFiles: ['e2e/test/unit/*.test.ts'], nodeArgs: [source] },
  },
  { LzJsNumericLiteral: true },
);
