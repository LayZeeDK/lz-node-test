import { testCode } from '../../stryker.base.mjs';
import base from './stryker.config.mjs';

export default await testCode({
  ...base,
  mutate: ['packages/lz-stryker-node-test-mutators/test/**/*.test.ts'],
  incrementalFile: 'reports/stryker-incremental/lz-stryker-node-test-mutators.test-code.json',
});
