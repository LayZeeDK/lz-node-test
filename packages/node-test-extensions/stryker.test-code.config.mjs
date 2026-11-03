import { reportFiles, testCode } from '../../stryker.base.mjs';
import base from './stryker.config.mjs';

export default await testCode({
  ...base,
  mutate: ['packages/node-test-extensions/test/**/*.test.ts'],
  incrementalFile: 'reports/stryker-incremental/@layzee/node-test-extensions.test-code.json',
  ...reportFiles('@layzee/node-test-extensions.test-code'),
});
