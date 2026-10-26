import assert from 'node:assert/strict';
import { before, it } from 'node:test';

import { lzTestFor } from '@layzee/lz-node-test';

import { double } from '../src/double.js';
import { half } from '../src/half.js';
import { negate } from '../src/negate.js';
import { triple } from '../src/triple.js';

let tripled;

// Only the hook calls triple(), so its mutants have coverage only when the runner records what a hook reaches.
before(() => {
  tripled = triple(3);
});

it.only('doubles under a plan', (t) => {
  t.plan(1);
  t.assert.equal(double(2), 4);
});

it.only('reads what a before hook computed', () => {
  assert.equal(tripled, 9);
});

lzTestFor.only([{ n: 2, negated: -2 }])('negates $n to $negated', ({ n, negated }, t) => {
  t.assert.equal(negate(n), negated);
});

// nodeArgs passes --test-only, so this test never runs.
it('halves', () => {
  assert.equal(half(4), 2);
});
