import type { NodePath, types } from '@babel/core';

import { assertMethod, importOf, isTestContext, propertyName } from './bindings.ts';
import type { Operator } from './operator.ts';

const message = 'Stryker';
const testFunctions: ReadonlySet<string | undefined> = new Set(['it', 'test', undefined]);

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

    const method = path.key === 0 ? assertMethod(path, call.callee) : undefined;
    const error = t.newExpression(t.identifier('Error'), [t.stringLiteral(message)]);

    if (method === 'throws' || expectsMatchedFailure(path, call)) {
      yield t.arrowFunctionExpression([], t.blockStatement([t.throwStatement(error)]));
    }

    if (method === 'rejects') {
      yield t.callExpression(t.memberExpression(t.identifier('Promise'), t.identifier('reject')), [error]);
    }
  },
};

function expectsMatchedFailure(path: NodePath, call: types.CallExpression): boolean {
  const last = call.arguments.length - 1;
  const options = call.arguments[last - 1];

  return (
    path.key === last &&
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

/** node:test's `it` or `test`, imported, or the test context's `test`. */
function isNodeTest(path: NodePath, callee: types.Node): boolean {
  if (callee.type === 'Identifier') {
    const from = importOf(path, callee.name);

    return from?.source === 'node:test' && testFunctions.has(from.imported);
  }

  return (
    callee.type === 'MemberExpression' &&
    propertyName(callee) === 'test' &&
    callee.object.type === 'Identifier' &&
    isTestContext(path, callee.object)
  );
}
