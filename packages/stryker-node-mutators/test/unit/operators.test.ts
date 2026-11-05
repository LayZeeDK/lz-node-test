import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nodeOperators, nodeOperatorSets } from '../../src/operators.ts';

describe('nodeOperatorSets', () => {
  it('names the default operators', () => {
    assert.deepEqual(
      nodeOperatorSets.defaults.map(({ name }) => name),
      ['LzNodeTimerDelay', 'LzNodeEventName', 'LzNodeAwaitStatement', 'LzNodeReturnAwait', 'LzNodeExitCode'],
    );
  });

  it('names the opt-in operators', () => {
    assert.deepEqual(
      nodeOperatorSets.optIn.map(({ name }) => name),
      ['LzNodeAssertStatement', 'LzNodeListenerOnce'],
    );
  });

  it('names the experimental operators', () => {
    assert.deepEqual(
      nodeOperatorSets.experimental.map(({ name }) => name),
      ['LzNodeByteLength', 'LzNodeCallbackError'],
    );
  });
});

describe('nodeOperators', () => {
  it('lists every operator of the sets', () => {
    assert.deepEqual(nodeOperators, [
      ...nodeOperatorSets.defaults,
      ...nodeOperatorSets.optIn,
      ...nodeOperatorSets.experimental,
    ]);
  });
});
