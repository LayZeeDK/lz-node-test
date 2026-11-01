import { it } from 'node:test';

import { isReady } from '../src/ready.js';

// Under a mutant that makes isReady() false, the test waits on a timer far longer than Stryker's timeout, and no
// mutant hit counts up, so only Stryker's own timer ends it.
it('goes on once ready', async () => {
  await new Promise((resolve) => {
    if (isReady()) {
      resolve();
    } else {
      setTimeout(resolve, 60_000);
    }
  });
});
