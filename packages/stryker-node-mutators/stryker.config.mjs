import base, { production, reportFiles, source } from '../../stryker.base.mjs';

export default await production(
  {
    ...base,
    // The synthetic sample is code that exists to be mutated by the production mutators.
    mutate: [
      'packages/stryker-node-mutators/src/**/*.ts',
      'packages/stryker-node-mutators/test/synthetic/node-apis.ts',
    ],
    tsconfigFile: 'packages/stryker-node-mutators/tsconfig.stryker.json',
    incrementalFile: 'reports/stryker-incremental/@layzee/stryker-node-mutators.src.json',
    ...reportFiles('@layzee/stryker-node-mutators.src'),
    lzNodeTest: { testFiles: ['packages/stryker-node-mutators/test/**/*.test.ts'], nodeArgs: [source] },
  },
  { LzJsNumericLiteral: true },
);
