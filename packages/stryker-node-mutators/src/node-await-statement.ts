import type { NodePath } from '@babel/core';

import { lzImportOf, lzPropertyName, type LzOperator } from '@layzee/stryker-mutator-core';
import { lzBuiltin } from './bindings.ts';
import { isNodeAssertCall } from './node-bindings.ts';

const nodeTest = lzBuiltin('test');
const teardowns: ReadonlySet<string | undefined> = new Set(['after', 'afterEach']);
const tests: ReadonlySet<string | undefined> = new Set(['test']);

/**
 * StatementRemoval for `await f();`: Stryker's CallExpression mutator removes `f();` but not an awaited call, so a
 * floating-promise lint rule that adds the `await` would take the call out of mutation testing. Like that removal,
 * this one is dropped when another mutant shares the statement, as in `await f('x');`. An awaited `node:assert` call is
 * left to LzNodeAssertStatement. Statements inside a node:test `after` or `afterEach` callback are left alone: their
 * removal skips a teardown, such as `await app.close()`, that no assertion reads, and often hangs the test.
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
      !isNodeAssertCall(path, expression.argument) &&
      path.findParent((parent) => parent.isFunction() && isTeardownCallback(parent)) === null
    ) {
      yield t.emptyStatement();
    }
  },
  filter: (mutantsInScope) => mutantsInScope.length === 1,
};

function isTeardownCallback(callback: NodePath): boolean {
  return isNodeTestCallback(callback, (imported) => teardowns.has(imported), teardowns);
}

/** A parameter that a node:test call, or a test context's `test` call, passes to its callback. */
function isTestContext(path: NodePath, name: string): boolean {
  const callback = path.scope.getBinding(name)?.path.parentPath;

  return callback?.isFunction() === true && isNodeTestCallback(callback, () => true, tests);
}

/**
 * Whether `callback` is an argument of a call of a node:test import that `accepts`, or of a test context method in
 * `methods`.
 */
function isNodeTestCallback(
  callback: NodePath,
  accepts: (imported: string | undefined) => boolean,
  methods: ReadonlySet<string | undefined>,
): boolean {
  const call = callback.parentPath;

  if (call.node.type !== 'CallExpression') {
    return false;
  }

  const { callee } = call.node;

  if (callee.type === 'Identifier') {
    const from = lzImportOf(call, callee.name);

    return from !== undefined && nodeTest.has(from.source) && accepts(from.imported);
  }

  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    methods.has(lzPropertyName(callee)) &&
    isTestContext(call, callee.object.name)
  );
}
