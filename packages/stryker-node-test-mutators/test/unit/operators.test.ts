import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { testOperators } from '../../src/operators.ts';

describe('testOperators', () => {
  it('names the test-code operators', () => {
    assert.deepEqual(
      testOperators.map(({ name }) => name),
      ['LzNodeTestAssertCall', 'LzNodeTestAssertValidator'],
    );
  });
});
