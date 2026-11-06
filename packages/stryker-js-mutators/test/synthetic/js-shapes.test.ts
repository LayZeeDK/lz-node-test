import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { firstTwo, latest, remember } from './js-shapes.ts';

describe('remember', () => {
  it('sets the latest id, which starts empty', () => {
    const before = latest.id;

    remember('b');

    assert.deepEqual([before, latest.id], ['', 'b']);
  });
});

describe('firstTwo', () => {
  it('takes the first two rows', () => {
    assert.deepEqual(firstTwo(['a', 'b', 'c', 'd']), ['a', 'b']);
  });
});
