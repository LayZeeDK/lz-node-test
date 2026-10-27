import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSync, traverse, types, type NodePath } from '@babel/core';

import { lzTestEach } from '@layzee/lz-node-test';
import { own, isOwn, toNodeMutator, type Operator } from '../../src/operator.ts';

const node = types.emptyStatement();

function programPath(): NodePath {
  const file = parseSync('', { babelrc: false, configFile: false });
  assert.ok(file);
  const paths: NodePath[] = [];
  traverse(file, {
    Program(path) {
      paths.push(path);
    },
  });
  const [path] = paths;
  assert.ok(path);

  return path;
}

const operator: Operator = {
  name: 'Alpha',
  sample: '',
  *mutate() {
    yield node;
  },
};

describe('own', () => {
  it('is the same symbol in every copy of the package', () => {
    assert.equal(own, Symbol.for('lz-stryker-node-test-mutators'));
  });
});

describe('toNodeMutator', () => {
  lzTestEach([
    [false, [node]],
    [true, []],
  ])('gives, where isExpressionContext is %s, %j', (isExpressionContext, nodes) => {
    const mutator = toNodeMutator(operator, types);

    assert.deepEqual([...mutator.mutate(programPath(), { isExpressionContext })], nodes);
    assert.equal(isOwn(mutator), true);
  });
});
