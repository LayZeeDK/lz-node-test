import base, { ignorePatternsKeepingE2e, reportFiles, source, testCode } from '../../stryker.base.mjs';

export default await testCode({
  ...base,
  mutate: ['tools/eslint-rules/*.test.ts'],
  ignorePatterns: ignorePatternsKeepingE2e,
  tsconfigFile: 'tools/eslint-rules/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/@layzee/eslint-rules.test-code.json',
  ...reportFiles('@layzee/eslint-rules.test-code'),
  lzNodeTest: { testFiles: ['tools/eslint-rules/*.test.ts'], nodeArgs: [source] },
});
