import { reportFiles, testCode } from '../../stryker.base.mjs';
import base from './stryker.config.mjs';

export default await testCode({
  ...base,
  mutate: ['packages/lz-node-test/test/**/*.test.ts'],
  incrementalFile: 'reports/stryker-incremental/lz-node-test.test-code.json',
  ...reportFiles('lz-node-test.test-code'),
});
