import { reportFiles, testCode } from '../../stryker.base.mjs';
import base from './stryker.config.mjs';

export default await testCode({
  ...base,
  mutate: ['packages/stryker-node-test-mutators/test/**/*.test.ts'],
  incrementalFile: 'reports/stryker-incremental/stryker-node-test-mutators.test-code.json',
  ...reportFiles('stryker-node-test-mutators.test-code'),
});
