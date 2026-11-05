import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LzNodeExperimentalMutator, LzNodeOptInMutator } from '../../src/index.ts';
import { nodeOperatorSets } from '../../src/operators.ts';

const optIn: readonly LzNodeOptInMutator[] = ['LzNodeAssertStatement', 'LzNodeListenerOnce'];
const experimental: readonly LzNodeExperimentalMutator[] = ['LzNodeByteLength', 'LzNodeCallbackError'];

describe('nodeOperatorSets', () => {
  it('names the default operators', () => {
    assert.deepEqual(
      nodeOperatorSets.defaults.map(({ name }) => name),
      ['LzNodeTimerDelay', 'LzNodeEventName', 'LzNodeAwaitStatement', 'LzNodeReturnAwait', 'LzNodeExitCode'],
    );
  });

  it('names the opt-in operators as the options type does', () => {
    assert.deepEqual(
      nodeOperatorSets.optIn.map(({ name }) => name),
      optIn,
    );
  });

  it('names the experimental operators as the options type does', () => {
    assert.deepEqual(
      nodeOperatorSets.experimental.map(({ name }) => name),
      experimental,
    );
  });
});
