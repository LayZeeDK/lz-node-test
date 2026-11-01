import assert from 'node:assert/strict';
import { it } from 'node:test';

import { twice } from '../src/twice.js';

// Reaches no mutant, and fails in any mutant run that runs it. It comes first, so a mutant run that runs every test,
// not only the ones that reach the mutant, has it among its killers.
it('runs in no mutant run that does not need it', () => {
  assert.equal(globalThis.__stryker__?.activeMutant, undefined);
});

it('doubles', () => {
  assert.equal(twice(2), 4);
});
