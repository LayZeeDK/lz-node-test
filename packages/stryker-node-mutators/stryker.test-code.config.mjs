import { reportFiles, testCode } from '../../stryker.base.mjs';
import base from './stryker.config.mjs';

export default await testCode({
  ...base,
  mutate: ['packages/stryker-node-mutators/test/**/*.test.ts'],
  incrementalFile: 'reports/stryker-incremental/@layzee/stryker-node-mutators.test-code.json',
  ...reportFiles('@layzee/stryker-node-mutators.test-code'),
});
