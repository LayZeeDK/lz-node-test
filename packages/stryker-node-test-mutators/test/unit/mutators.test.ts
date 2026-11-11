import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { testMutators, testMutatorSets } from '../../src/mutators.ts';

describe('testMutatorSets', () => {
  it('names the default test-code mutators', () => {
    assert.deepEqual(
      testMutatorSets.defaults.map(({ name }) => name),
      ['LzNodeTestAssertCall', 'LzNodeTestAssertValidator'],
    );
  });

  it('has no opt-in test-code mutators', () => {
    assert.deepEqual(testMutatorSets.optIn, []);
  });

  it('names the experimental test-code mutators', () => {
    assert.deepEqual(
      testMutatorSets.experimental.map(({ name }) => name),
      ['LzNodeTestCatchAssert'],
    );
  });
});

describe('testMutators', () => {
  it('lists every mutator of the sets', () => {
    assert.deepEqual(testMutators, [
      ...testMutatorSets.defaults,
      ...testMutatorSets.optIn,
      ...testMutatorSets.experimental,
    ]);
  });
});
