import type { NodePath } from '@babel/core';

import type { Operator } from './operator.ts';

/**
 * `return await x` becomes `return x` in a `try` block, where the `catch` and `finally` then no longer wait for `x` to
 * settle. An async generator is left out: its `return` awaits the value either way.
 */
export const returnAwait: Operator = {
  name: 'LzReturnAwait',
  sample:
    'export async function read(load: () => Promise<number>) {\n  try {\n    return await load();\n  } catch {\n    return 0;\n  }\n}\n',
  *mutate(path, t) {
    if (path.isAwaitExpression() && path.parent.type === 'ReturnStatement' && isInAsyncFunctionTryBlock(path)) {
      yield t.cloneNode(path.node.argument);
    }
  },
};

function isInAsyncFunctionTryBlock(path: NodePath): boolean {
  const boundary = path.findParent((parent) => parent.isFunction() || parent.key === 'block');

  return boundary?.parentPath?.isTryStatement() === true && boundary.getFunctionParent()?.node.generator !== true;
}
