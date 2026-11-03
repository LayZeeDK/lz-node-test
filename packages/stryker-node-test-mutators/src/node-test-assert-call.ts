import type { NodePath, types } from '@babel/core';

import { lzAwaited, type LzBabelTypes, type LzOperator } from '@layzee/stryker-mutator-core';
import { lzAssertMethod } from '@layzee/stryker-node-mutators/bindings';

const message = 'Stryker: assertion reached';
const asyncMethods: ReadonlySet<string> = new Set(['rejects', 'doesNotReject']);

/**
 * FailureAddition: makes an assertion fail, so a survivor is a check whose failure nothing sees. A check that never
 * runs reaches no coverage, so its mutant comes out NoCoverage instead.
 * An assertion statement keeps its call ahead of the `throw`, so it fails right after it runs and the code after it
 * keeps the types it narrows. An assertion that is an arrow function's body or a returned value fails in its place
 * instead, through the channel the real check uses: a rejected promise for `rejects` and `doesNotReject`, a throw for
 * the others, a custom assertion added with `assert.register` included. There the original call is kept only for its
 * type and never runs.
 */
export const nodeTestAssertCall: LzOperator = {
  name: 'LzNodeTestAssertCall',
  sample: 'export function check(t: any) {\n  t.assert.ok(true);\n}\n',
  *mutate(path, t) {
    if (path.isExpressionStatement() && assertionMethod(path, lzAwaited(path.node.expression)) !== undefined) {
      yield t.blockStatement([t.cloneNode(path.node), t.throwStatement(error(t))]);
    }

    if (path.isCallExpression() && isTail(path)) {
      const method = assertionMethod(path, path.node);

      if (method !== undefined) {
        yield t.parenthesizedExpression(
          t.conditionalExpression(t.booleanLiteral(true), failure(t, method), t.cloneNode(path.node)),
        );
      }
    }
  },
};

function error(t: LzBabelTypes): types.NewExpression {
  return t.newExpression(t.identifier('Error'), [t.stringLiteral(message)]);
}

function failure(t: LzBabelTypes, method: string): types.CallExpression {
  if (asyncMethods.has(method)) {
    return t.callExpression(t.memberExpression(t.identifier('Promise'), t.identifier('reject')), [error(t)]);
  }

  return t.callExpression(t.arrowFunctionExpression([], t.blockStatement([t.throwStatement(error(t))])), []);
}

function isTail(path: NodePath): boolean {
  const value = path.parent.type === 'AwaitExpression' ? path.parentPath : path;

  return value.parent.type === 'ArrowFunctionExpression' || value.parent.type === 'ReturnStatement';
}

function assertionMethod(path: NodePath, node: types.Expression): string | undefined {
  if (node.type !== 'CallExpression') {
    return undefined;
  }

  const method = lzAssertMethod(path, node.callee);

  return method === 'fail' ? undefined : method;
}
