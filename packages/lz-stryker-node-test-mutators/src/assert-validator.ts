import type { NodePath, types } from '@babel/core';

import { assertMethod, importOf, isTestContext, propertyName } from './bindings.ts';
import type { Operator } from './operator.ts';

const message = 'Stryker';
const testFunctions: ReadonlySet<string | undefined> = new Set(['it', 'test']);
const testModifiers: ReadonlySet<string | undefined> = new Set(['only', 'skip', 'todo']);

/**
 * Makes the code that `assert.throws` or `assert.rejects` checks, or the test function of a node:test test whose
 * `expectFailure` names what the failure must match, throw an unrelated error, so a survivor is a validator that
 * accepts any error.
 */
export const assertValidator: Operator = {
  name: 'LzAssertValidator',
  sample: "import assert from 'node:assert/strict';\n\nassert.throws(() => {}, /x/);\n",
  *mutate(path, t) {
    const call = path.parent;

    if (!path.isExpression() || call.type !== 'CallExpression') {
      return;
    }

    const method = checkedBy(path, call);
    const error = t.newExpression(t.identifier('Error'), [t.stringLiteral(message)]);

    if (method === 'throws') {
      yield t.arrowFunctionExpression([], t.blockStatement([t.throwStatement(error)]));
    }

    if (method === 'rejects') {
      yield t.callExpression(t.memberExpression(t.identifier('Promise'), t.identifier('reject')), [error]);
    }
  },
};

/** How a validator expects the argument at `path` to fail: the assertion's method, or `throws` for a test function. */
function checkedBy(path: NodePath, call: types.CallExpression): string | undefined {
  if (path.key === 0) {
    return assertMethod(path, call.callee);
  }

  return path.key === call.arguments.length - 1 && expectsMatchedFailure(path, call) ? 'throws' : undefined;
}

function expectsMatchedFailure(path: NodePath, call: types.CallExpression): boolean {
  const options = call.arguments.at(-2);

  return (
    options?.type === 'ObjectExpression' &&
    isMatcher(propertyValue(options, 'expectFailure')) &&
    isNodeTest(path, call.callee)
  );
}

/**
 * A string or `true` only labels the expected failure. So does an object with a `label` or a `match`, whose `match`
 * is a matcher unless it is a string, which node:test passes to `assert.throws` as its message.
 */
function isMatcher(value: types.Node | undefined): boolean {
  if (value === undefined || isLabel(value)) {
    return false;
  }

  if (value.type !== 'ObjectExpression') {
    return true;
  }

  const match = propertyValue(value, 'match');

  return (match === undefined && propertyValue(value, 'label') === undefined) || isMatcher(match);
}

function isLabel(value: types.Node): boolean {
  return value.type === 'StringLiteral' || value.type === 'TemplateLiteral' || value.type === 'BooleanLiteral';
}

function propertyValue(object: types.ObjectExpression, key: string): types.Node | undefined {
  const property = object.properties.find(
    (candidate) =>
      candidate.type === 'ObjectProperty' &&
      !candidate.computed &&
      candidate.key.type === 'Identifier' &&
      candidate.key.name === key,
  );

  return property?.type === 'ObjectProperty' ? property.value : undefined;
}

/**
 * node:test's `it` or `test`, as an import or a member of the module's default or namespace import, or the test
 * context's `test`; called as it is or through `only`, `skip` or `todo`.
 */
function isNodeTest(path: NodePath, callee: types.Node): boolean {
  const test = callee.type === 'MemberExpression' && testModifiers.has(propertyName(callee)) ? callee.object : callee;

  if (test.type === 'Identifier') {
    const from = importOf(path, test.name);

    return from?.source === 'node:test' && (from.imported === undefined || testFunctions.has(from.imported));
  }

  if (test.type !== 'MemberExpression' || test.object.type !== 'Identifier' || !testFunctions.has(propertyName(test))) {
    return false;
  }

  const from = importOf(path, test.object.name);

  return from === undefined
    ? propertyName(test) === 'test' && isTestContext(path, test.object)
    : from.source === 'node:test' && from.imported === undefined;
}
