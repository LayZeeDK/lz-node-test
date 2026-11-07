import base, { production, reportFiles, source } from '../../stryker.base.mjs';

export default await production(
  {
    ...base,
    mutate: ['packages/node-test-extensions/src/**/*.ts'],
    tsconfigFile: 'packages/node-test-extensions/tsconfig.stryker.json',
    incrementalFile: 'reports/stryker-incremental/@layzee/node-test-extensions.src.json',
    ...reportFiles('@layzee/node-test-extensions.src'),
    lzNodeTest: { testFiles: ['packages/node-test-extensions/test/**/*.test.ts'], nodeArgs: [source] },
  },
  { LzJsNumericLiteral: true },
);
