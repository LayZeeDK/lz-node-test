import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nodeMutators, nodeMutatorSets } from '../../src/mutators.ts';

describe('nodeMutatorSets', () => {
  it('names the default mutators', () => {
    assert.deepEqual(
      nodeMutatorSets.defaults.map(({ name }) => name),
      ['LzNodeTimerDelay', 'LzNodeEventName', 'LzNodeAwaitStatement', 'LzNodeReturnAwait', 'LzNodeExitCode'],
    );
  });

  it('names the opt-in mutators', () => {
    assert.deepEqual(
      nodeMutatorSets.optIn.map(({ name }) => name),
      ['LzNodeAssertStatement', 'LzNodeListenerOnce'],
    );
  });

  it('names the experimental mutators', () => {
    assert.deepEqual(
      nodeMutatorSets.experimental.map(({ name }) => name),
      ['LzNodeByteLength', 'LzNodeCallbackError'],
    );
  });
});

describe('nodeMutators', () => {
  it('lists every mutator of the sets', () => {
    assert.deepEqual(nodeMutators, [
      ...nodeMutatorSets.defaults,
      ...nodeMutatorSets.optIn,
      ...nodeMutatorSets.experimental,
    ]);
  });
});
