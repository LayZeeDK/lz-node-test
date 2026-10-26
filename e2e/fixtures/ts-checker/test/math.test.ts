import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/lz-node-test';

import { add, isEven } from '../src/math.ts';

describe('add', () => {
  lzTestEach([
    [2, 3, 5],
    [-1, 1, 0],
  ])('adds %d and %d to %d', (a, b, sum) => {
    assert.equal(add(a, b), sum);
  });
});

describe('isEven', () => {
  lzTestEach([
    [4, true],
    [5, false],
  ])('says %d is even: %s', (n, even) => {
    assert.equal(isEven(n), even);
  });
});
