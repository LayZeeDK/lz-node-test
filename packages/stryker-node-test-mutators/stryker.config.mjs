import base, { production, reportFiles, source } from '../../stryker.base.mjs';

export default await production(
  {
    ...base,
    mutate: ['packages/stryker-node-test-mutators/src/**/*.ts'],
    tsconfigFile: 'packages/stryker-node-test-mutators/tsconfig.stryker.json',
    incrementalFile: 'reports/stryker-incremental/@layzee/stryker-node-test-mutators.src.json',
    ...reportFiles('@layzee/stryker-node-test-mutators.src'),
    lzNodeTest: { testFiles: ['packages/stryker-node-test-mutators/test/**/*.test.ts'], nodeArgs: [source] },
  },
  { LzJsNumericLiteral: true },
);
