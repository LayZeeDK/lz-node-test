import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LzNodeTestExperimentalMutator } from '../../src/index.ts';
import { testOperatorSets } from '../../src/operators.ts';

const experimental: readonly LzNodeTestExperimentalMutator[] = ['LzNodeTestCatchAssert'];

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

  it('names the experimental test-code operators as the options type does', () => {
    assert.deepEqual(
      testOperatorSets.experimental.map(({ name }) => name),
      experimental,
    );
  });
});
