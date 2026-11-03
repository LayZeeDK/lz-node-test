import type { LzOperator } from '@layzee/stryker-mutator-core';
import { isNodeAssertCall } from './bindings.ts';

/**
 * StatementRemoval for `await f();`: Stryker's CallExpression mutator removes `f();` but not an awaited call, so a
 * floating-promise lint rule that adds the `await` would take the call out of mutation testing. Like that removal,
 * this one is dropped when another mutant shares the statement, as in `await f('x');`. An awaited `node:assert` call is
 * left to LzNodeAssertStatement.
 */
export const nodeAwaitStatement: LzOperator = {
  name: 'LzNodeAwaitStatement',
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
  filter: (mutantsInScope) => mutantsInScope.length === 1,
};
