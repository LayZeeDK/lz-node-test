import { testCode } from '../../stryker.base.mjs';
import base from './stryker.config.mjs';

export default await testCode({
  ...base,
  mutate: ['packages/lz-stryker-node-test-runner/test/**/*.test.ts'],
});
