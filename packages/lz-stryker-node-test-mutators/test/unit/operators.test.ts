import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/lz-node-test';
import { operatorsFor, productionOperators, testOperators } from '../../src/operators.ts';

describe('the catalogues', () => {
  lzTestEach([
    ['production', productionOperators, ['LzNodeTimerDelay', 'LzNodeEventName', 'LzAssertStatement']],
    ['test', testOperators, ['LzAssertCall', 'LzAssertValidator']],
  ])('name the %s operators', (_title, operators, names) => {
    assert.deepEqual(
      operators.map(({ name }) => name),
      names,
    );
  });
});

describe('operatorsFor', () => {
  lzTestEach([
    ['tools/runner/process-end.test.ts', testOperators],
    ['tools/runner/process-end.ts', productionOperators],
    ['tools/runner/index.fixtures.ts', productionOperators],
    ['tools/runner/test.ts', productionOperators],
  ])('gives %s its catalogue', (name, operators) => {
    assert.equal(operatorsFor(name), operators);
  });
});
