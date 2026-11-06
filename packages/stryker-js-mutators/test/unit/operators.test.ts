import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { jsOperators, jsOperatorSets } from '../../src/operators.ts';

describe('jsOperatorSets', () => {
  it('names the default operators', () => {
    assert.deepEqual(
      jsOperatorSets.defaults.map(({ name }) => name),
      [],
    );
  });

  it('names the opt-in operators', () => {
    assert.deepEqual(
      jsOperatorSets.optIn.map(({ name }) => name),
      [],
    );
  });

  it('names the experimental operators', () => {
    assert.deepEqual(
      jsOperatorSets.experimental.map(({ name }) => name),
      ['LzJsAssignmentStatement'],
    );
  });
});

describe('jsOperators', () => {
  it('lists every operator of the sets', () => {
    assert.deepEqual(jsOperators, [
      ...jsOperatorSets.defaults,
      ...jsOperatorSets.optIn,
      ...jsOperatorSets.experimental,
    ]);
  });
});
