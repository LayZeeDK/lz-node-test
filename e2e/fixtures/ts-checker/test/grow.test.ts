import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldGrow } from '../src/grow.ts';

// Under a mutant that makes shouldGrow() true, the test holds up to 1.5 GB before its assertion fails. With
// maxMemoryMB at 300 the runner ends the process first and Stryker reports a timeout; without the limit the assertion
// fails and Stryker reports the mutant killed.
test('grows only when told to', () => {
  const held: Buffer[] = [];

  if (shouldGrow()) {
    for (let i = 0; i < 96; i++) {
      held.push(Buffer.alloc(16 * 1024 * 1024, 1));
    }
  }

  assert.equal(shouldGrow(), false);
  assert.ok(held.length >= 0);
});
