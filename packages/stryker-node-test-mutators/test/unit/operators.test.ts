import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { testOperators, testOperatorSets } from '../../src/operators.ts';

describe('testOperatorSets', () => {
  it('names the default test-code operators', () => {
    assert.deepEqual(
      testOperatorSets.defaults.map(({ name }) => name),
      ['LzNodeTestAssertCall', 'LzNodeTestAssertValidator'],
    );
  });

  it('has no opt-in test-code operators', () => {
    assert.deepEqual(testOperatorSets.optIn, []);
  });

  it('names the experimental test-code operators', () => {
    assert.deepEqual(
      testOperatorSets.experimental.map(({ name }) => name),
      ['LzNodeTestCatchAssert'],
    );
  });
});

describe('testOperators', () => {
  it('lists every operator of the sets', () => {
    assert.deepEqual(testOperators, [
      ...testOperatorSets.defaults,
      ...testOperatorSets.optIn,
      ...testOperatorSets.experimental,
    ]);
  });
});
