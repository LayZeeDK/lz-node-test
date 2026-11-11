import type { NodePath, types } from '@babel/core';

import { lzImportOf, lzPropertyName, type LzMutator } from '@layzee/stryker-mutator-core';
import { lzAssertMethod, lzNodeTest } from '@layzee/stryker-node-mutators/bindings';

const message = 'Stryker';
const testFunctions: ReadonlySet<string | undefined> = new Set(['it', 'test']);
const uncountedOptions: readonly string[] = ['skip', 'todo'];
const labelKeys: ReadonlySet<string | undefined> = new Set(['label', 'match']);
const matcherTypes: ReadonlySet<string> = new Set([
  'RegExpLiteral',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassExpression',
  'MemberExpression',
]);

/**
 * Makes the code that `assert.throws` or `assert.rejects` checks, or the test function of a node:test test whose
 * `expectFailure` names what the failure must match, throw an unrelated error, so a survivor is a validator that
 * accepts any error.
 */
export const nodeTestAssertValidator: LzMutator = {
  name: 'LzNodeTestAssertValidator',
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
    return lzAssertMethod(path, call.callee);
  }

  return path.key === call.arguments.length - 1 && expectsMatchedFailure(path, call) ? 'throws' : undefined;
}

function expectsMatchedFailure(path: NodePath, call: types.CallExpression): boolean {
  const options = call.arguments.at(-2);

  return (
    options?.type === 'ObjectExpression' &&
    isMatcher(propertyValue(options, 'expectFailure')) &&
    options.properties.every((property) => property.type !== 'SpreadElement') &&
    !uncountedOptions.some((key) => isSet(propertyValue(options, key))) &&
    isNodeTest(path, call.callee)
  );
}

/** Whether a `skip` or `todo` option is set, so the test never runs or its failure fails nothing. */
function isSet(value: types.Node | undefined): boolean {
  return value !== undefined && !(value.type === 'BooleanLiteral' && !value.value);
}

/**
 * What node:test checks the failure against: a RegExp, a function or class, an object of what the error must hold, or
 * a variable or member that may hold one. An object of only `label` and `match` is a label, and its `match` is the
 * matcher unless it is a string, which node:test passes to `assert.throws` as its message. Anything else, such as a
 * string, `true` or a number, only labels the failure.
 */
function isMatcher(value: types.Node | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  if (value.type !== 'ObjectExpression') {
    return mayHoldMatcher(value);
  }

  if (!isLabelObject(value)) {
    return true;
  }

  const match = propertyValue(value, 'match');

  return match !== undefined && (match.type === 'ObjectExpression' || mayHoldMatcher(match));
}

function mayHoldMatcher(value: types.Node): boolean {
  return value.type === 'Identifier' ? value.name !== 'undefined' : matcherTypes.has(value.type);
}

function isLabelObject(object: types.ObjectExpression): boolean {
  return object.properties.length > 0 && object.properties.every((property) => labelKeys.has(keyOf(property)));
}

function propertyValue(object: types.ObjectExpression, key: string): types.Node | undefined {
  const property = object.properties.find((candidate) => keyOf(candidate) === key);

  return property?.type === 'ObjectProperty' ? property.value : undefined;
}

function keyOf(property: types.ObjectExpression['properties'][number]): string | undefined {
  return property.type === 'ObjectProperty' && !property.computed && property.key.type === 'Identifier'
    ? property.key.name
    : undefined;
}

/**
 * node:test's `it` or `test`, as an import or a member of the module's default or namespace import, or the test
 * context's `test`; called as it is or through `only`. A `skip` test never runs and a `todo` test's failure fails
 * nothing, so a mutant there would survive whatever the matcher.
 */
function isNodeTest(path: NodePath, callee: types.Node): boolean {
  const test = callee.type === 'MemberExpression' && lzPropertyName(callee) === 'only' ? callee.object : callee;

  if (test.type === 'Identifier') {
    return isTestImport(lzImportOf(path, test.name));
  }

  if (
    test.type !== 'MemberExpression' ||
    test.object.type !== 'Identifier' ||
    !testFunctions.has(lzPropertyName(test))
  ) {
    return false;
  }

  const from = lzImportOf(path, test.object.name);

  return from === undefined ? lzPropertyName(test) === 'test' && isTestContext(path, test.object) : isTestImport(from);
}

/** node:test's default or namespace import, or its `it` or `test`, which also carry the other test functions. */
function isTestImport(from: ReturnType<typeof lzImportOf>): boolean {
  return (
    from !== undefined &&
    lzNodeTest.has(from.source) &&
    (from.imported === undefined || testFunctions.has(from.imported))
  );
}

/** A parameter, which node:test passes the test context in. */
function isTestContext(path: NodePath, identifier: types.Identifier): boolean {
  return path.scope.getBinding(identifier.name)?.kind === 'param';
}
