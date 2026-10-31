import { testCode } from '../../stryker.base.mjs';
import base from './stryker.config.mjs';

export default await testCode({
  ...base,
  mutate: ['tools/eslint-rules/*.test.ts'],
  incrementalFile: 'reports/stryker-incremental/eslint-rules.test-code.json',
});
