import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/lz-node-test';

import { isAdult } from '../src/age.js';

// No case sits at 18, so the boundary mutant age > 18 survives; isSenior has no test at all.
describe('isAdult', () => {
  lzTestEach([
    [30, true],
    [10, false],
  ])('says %d is adult: %s', (age, adult) => {
    assert.equal(isAdult(age), adult);
  });
});
