import { reportFiles, testCode } from '../../stryker.base.mjs';
import base from './stryker.config.mjs';

export default await testCode({
  ...base,
  mutate: ['packages/stryker-mutator-core/test/**/*.test.ts'],
  incrementalFile: 'reports/stryker-incremental/@layzee/stryker-mutator-core.test-code.json',
  ...reportFiles('@layzee/stryker-mutator-core.test-code'),
});
