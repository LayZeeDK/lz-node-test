import type { NodePath, types } from '@babel/core';

import { lzCalleeRoot, lzPropertyName, type LzOperator } from '@layzee/stryker-mutator-core';

/**
 * Empties the `try` block of a `try`/`catch` whose `catch` asserts and does not throw, so a survivor is a test that
 * passes when the code under test stops throwing; `assert.throws` or a plan would catch it. Assertions are matched by
 * syntax, so CommonJS `require` of node:assert counts, unlike in LzNodeTestAssertCall, which follows the import: any
 * method other than `fail` of a callee rooted at `assert` or of an `assert` member, and a call of `assert` itself.
 * Functions inside the `catch` are not searched.
 */
export const nodeTestCatchAssert: LzOperator<'LzNodeTestCatchAssert'> = {
  name: 'LzNodeTestCatchAssert',
  sample: "try {\n  JSON.parse('');\n} catch (error) {\n  assert.ok(error);\n}\n",
  *mutate(path, t) {
    if (!path.isBlockStatement() || path.node.body.length === 0) {
      return;
    }

    const { parentPath } = path;

    if (!parentPath.isTryStatement() || parentPath.node.block !== path.node) {
      return;
    }

    const handler = parentPath.get('handler');

    if (handler.isCatchClause() && assertsWithoutThrow(handler.get('body'))) {
      yield t.blockStatement([]);
    }
  },
};

function assertsWithoutThrow(body: NodePath<types.BlockStatement>): boolean {
  const found = { asserts: false, throws: false };

  body.traverse({
    ThrowStatement() {
      found.throws = true;
    },
    CallExpression(call) {
      if (isAssertion(call.node.callee)) {
        found.asserts = true;
      }
    },
    Function(inner) {
      inner.skip();
    },
  });

  return found.asserts && !found.throws;
}

function isAssertion(callee: types.Node): boolean {
  if (callee.type === 'Identifier') {
    return callee.name === 'assert';
  }

  const method = lzPropertyName(callee);

  if (method === undefined || method === 'fail') {
    return false;
  }

  return (
    lzCalleeRoot(callee)?.name === 'assert' ||
    (callee.type === 'MemberExpression' && lzPropertyName(callee.object) === 'assert')
  );
}
