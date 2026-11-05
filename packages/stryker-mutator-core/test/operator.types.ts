import type { NodePath, types } from '@babel/core';

import type { LzOperator } from '../src/operator.ts';

export const narrowed: LzOperator = {
  name: 'Narrowed',
  sample: '',
  // @ts-expect-error The instrumenter passes every path, not only call expressions.
  *mutate(path: NodePath<types.CallExpression>) {
    yield path.node;
  },
};
