import assert from 'node:assert/strict';
import { it } from 'node:test';

import { greeting } from '../src/greeting.js';

// greeting.js runs when this file imports it, before any test: the runner credits that to this file's test, so its
// mutant runs that test, active from the start of the process.
it('greets', () => {
  assert.equal(greeting, 'Hello');
});
