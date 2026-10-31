import { isNodeAssertCall } from './bindings.ts';
import type { Operator } from './operator.ts';

/**
 * StatementRemoval for `await f();`: Stryker's CallExpression mutator removes `f();` but not an awaited call, so a
 * floating-promise lint rule that adds the `await` would take the call out of mutation testing. An awaited
 * `node:assert` call is left to LzAssertStatement.
 */
export const awaitStatement: Operator = {
  name: 'LzAwaitStatement',
  sample: 'await flush();\n',
  *mutate(path, t) {
    if (!path.isExpressionStatement()) {
      return;
    }

    const { expression } = path.node;

    if (
      expression.type === 'AwaitExpression' &&
      expression.argument.type === 'CallExpression' &&
      !isNodeAssertCall(path, expression.argument)
    ) {
      yield t.emptyStatement();
    }
  },
};
