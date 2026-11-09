import base, { ignorePatternsKeepingE2e, production, reportFiles, source } from '../../stryker.base.mjs';

export default await production(
  {
    ...base,
    mutate: ['tools/eslint-rules/*.ts', '!tools/eslint-rules/*.test.ts', '!tools/eslint-rules/*.fixtures.ts'],
    ignorePatterns: ignorePatternsKeepingE2e,
    tsconfigFile: 'tools/eslint-rules/tsconfig.stryker.json',
    incrementalFile: 'reports/stryker-incremental/@layzee/eslint-rules.src.json',
    ...reportFiles('@layzee/eslint-rules.src'),
    lzNodeTest: { testFiles: ['tools/eslint-rules/*.test.ts'], nodeArgs: [source] },
  },
  { LzJsNumericLiteral: true },
);
