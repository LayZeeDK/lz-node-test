import { testCode } from '../../stryker.base.mjs';
import base from './stryker.config.mjs';

export default await testCode({
  ...base,
  mutate: [
    'packages/lz-node-test/test/**/*.test.ts',
    // Its t.assert.reports cases allow only the globals they name in the source of their own callbacks, and
    // instrumentation adds Stryker's.
    '!packages/lz-node-test/test/integration/register.test.ts',
  ],
});
