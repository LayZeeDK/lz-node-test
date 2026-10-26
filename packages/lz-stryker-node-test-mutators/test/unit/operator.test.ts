import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodePath, types } from '@babel/core';

import { lzTestEach } from '@layzee/lz-node-test';
import { OWN, isOwn, toNodeMutator, type BabelTypes, type Operator } from '../../src/operator.ts';

const NODE = { type: 'EmptyStatement' } as types.Node;

const operator: Operator = {
  name: 'Alpha',
  sample: '',
  *mutate() {
    yield NODE;
  },
};

describe('OWN', () => {
  it('is the same symbol in every copy of the package', () => {
    assert.equal(OWN, Symbol.for('lz-stryker-node-test-mutators'));
  });
});

describe('toNodeMutator', () => {
  lzTestEach([
    [false, [NODE]],
    [true, []],
  ])('gives, where isExpressionContext is %s, %j', (isExpressionContext, nodes) => {
    const mutator = toNodeMutator(operator, {} as BabelTypes);

    assert.deepEqual([...mutator.mutate({} as NodePath, { isExpressionContext })], nodes);
    assert.equal(isOwn(mutator), true);
  });
});
