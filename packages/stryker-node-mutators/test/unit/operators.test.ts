import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { productionOperators } from '../../src/operators.ts';

describe('productionOperators', () => {
  it('names the production operators', () => {
    assert.deepEqual(
      productionOperators.map(({ name }) => name),
      [
        'LzNodeTimerDelay',
        'LzNodeEventName',
        'LzNodeAssertStatement',
        'LzNodeAwaitStatement',
        'LzNodeReturnAwait',
        'LzNodeExitCode',
      ],
    );
  });
});
