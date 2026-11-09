import base, { concurrency, ignorePatternsKeepingE2e, production, reportFiles, source } from '../stryker.base.mjs';

export default await production(
  {
    ...base,
    // Its tests start node processes of their own: fake npm and Stryker, the sampler and the CLI entry modules.
    concurrency: concurrency(2),
    mutate: ['e2e/src/**/*.ts'],
    ignorePatterns: ignorePatternsKeepingE2e,
    tsconfigFile: 'e2e/tsconfig.stryker.json',
    incrementalFile: 'reports/stryker-incremental/e2e.src.json',
    ...reportFiles('e2e.src'),
    lzNodeTest: { testFiles: ['e2e/test/unit/*.test.ts'], nodeArgs: [source] },
  },
  { LzJsNumericLiteral: true },
);
