import type { NodePath } from '@babel/core';

import type { LzMutator } from '@layzee/stryker-mutator-core';

/**
 * `return await x` becomes `return x` in a `try` block, where the `catch` and `finally` then no longer wait for `x` to
 * settle, and in a `catch` block that a `finally` block follows, which then no longer waits. An async generator is left
 * out: its `return` awaits the value either way.
 */
export const nodeReturnAwait: LzMutator = {
  name: 'LzNodeReturnAwait',
  sample:
    'export async function read(load: () => Promise<number>) {\n  try {\n    return await load();\n  } catch {\n    return 0;\n  }\n}\n',
  *mutate(path, t) {
    if (path.isAwaitExpression() && path.parent.type === 'ReturnStatement' && isWaitedFor(path)) {
      yield t.cloneNode(path.node.argument);
    }
  },
};

function isWaitedFor(path: NodePath): boolean {
  const boundary = path.findParent((parent) => parent.isFunction() || isWaitedForBlock(parent));

  return boundary !== null && !boundary.isFunction() && boundary.getFunctionParent()?.node.generator !== true;
}

/** A `try` block, which its `catch` and `finally` wait for, or a `catch` clause, which a `finally` waits for. */
function isWaitedForBlock(path: NodePath): boolean {
  // The search reaches the Program, whose parentPath is null, when a parser option allows a return outside a function.
  if (path.isProgram()) {
    return false;
  }

  const { parentPath } = path;

  // Stryker disable next-line ConditionalExpression: equivalent, as only a try statement has a block or a handler
  if (!parentPath.isTryStatement()) {
    return false;
  }

  return path.key === 'block' || (path.key === 'handler' && Boolean(parentPath.node.finalizer));
}
