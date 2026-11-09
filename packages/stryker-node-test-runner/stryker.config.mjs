import base, { production, reportFiles, source } from '../../stryker.base.mjs';

export default await production(
  {
    ...base,
    mutate: ['packages/stryker-node-test-runner/src/**/*.ts'],
    tsconfigFile: 'packages/stryker-node-test-runner/tsconfig.stryker.json',
    incrementalFile: 'reports/stryker-incremental/@layzee/stryker-node-test-runner.src.json',
    ...reportFiles('@layzee/stryker-node-test-runner.src'),
    lzNodeTest: { testFiles: ['packages/stryker-node-test-runner/test/**/*.test.ts'], nodeArgs: [source] },
  },
  { LzJsNumericLiteral: true },
);
