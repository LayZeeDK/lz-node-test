import assert from 'node:assert/strict';
import { it } from 'node:test';

import { countdown } from '../src/countdown.js';

// Under a mutant that turns from-- into from++, the loop never ends, until Stryker's hit limit stops it.
it('counts down to zero', () => {
  assert.equal(countdown(3), 3);
});
