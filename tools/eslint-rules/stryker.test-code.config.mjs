import { testCode } from '../../stryker.base.mjs';
import base from './stryker.config.mjs';

export default await testCode({
  ...base,
  mutate: ['tools/eslint-rules/*.test.ts'],
});
