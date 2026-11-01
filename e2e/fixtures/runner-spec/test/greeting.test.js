import assert from 'node:assert/strict';
import { it } from 'node:test';

import { greeting } from '../src/greeting.js';

// greeting.js runs when this file imports it, before any test, so its mutant is static.
it('greets', () => {
  assert.equal(greeting, 'Hello');
});
