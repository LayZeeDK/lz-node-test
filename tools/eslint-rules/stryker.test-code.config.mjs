import { reportFiles, testCode } from '../../stryker.base.mjs';
import base from './stryker.config.mjs';

export default await testCode({
  ...base,
  mutate: ['tools/eslint-rules/*.test.ts'],
  incrementalFile: 'reports/stryker-incremental/@lz-node-test/eslint-rules.test-code.json',
  ...reportFiles('@lz-node-test/eslint-rules.test-code'),
});
