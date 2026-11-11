import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { jsMutators, jsMutatorSets } from '../../src/mutators.ts';

describe('jsMutatorSets', () => {
  it('names the default mutators', () => {
    assert.deepEqual(
      jsMutatorSets.defaults.map(({ name }) => name),
      [],
    );
  });

  it('names the opt-in mutators', () => {
    assert.deepEqual(
      jsMutatorSets.optIn.map(({ name }) => name),
      ['LzJsNumericLiteral'],
    );
  });

  it('names the experimental mutators', () => {
    assert.deepEqual(
      jsMutatorSets.experimental.map(({ name }) => name),
      ['LzJsAssignmentStatement'],
    );
  });
});

describe('jsMutators', () => {
  it('lists every mutator of the sets', () => {
    assert.deepEqual(jsMutators, [...jsMutatorSets.defaults, ...jsMutatorSets.optIn, ...jsMutatorSets.experimental]);
  });
});
