import type { Rule } from 'eslint';
import type { Node } from 'estree';

const loops = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const functions = new Set(['ArrowFunctionExpression', 'FunctionExpression']);
const assertModules = new Set(['assert', 'assert/strict', 'node:assert', 'node:assert/strict']);
const iterationMethods = new Set([
  'forEach',
  'map',
  'flatMap',
  'every',
  'some',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'reduce',
  'reduceRight',
]);
// Their second argument maps each element.
const arrayFactories = new Set(['from', 'fromAsync']);

/** `assert(x)`, `ok(x)` and `assert.ok(x)` through a node:assert import, or `t.assert.ok(x)` on a test context. */
function isAssertion(callee: Node, imported: ReadonlySet<string>): boolean {
  if (callee.type === 'Identifier') {
    return imported.has(callee.name);
  }

  if (callee.type !== 'MemberExpression') {
    return false;
  }

  const object = callee.object;

  return object.type === 'Identifier'
    ? imported.has(object.name)
    : object.type === 'MemberExpression' && object.property.type === 'Identifier' && object.property.name === 'assert';
}

function isIterationCallback(node: Node, callback: Node): boolean {
  if (
    node.type !== 'CallExpression' ||
    node.callee.type !== 'MemberExpression' ||
    node.callee.property.type !== 'Identifier'
  ) {
    return false;
  }

  const { object, property } = node.callee;

  if (object.type === 'Identifier' && object.name === 'Array' && arrayFactories.has(property.name)) {
    return node.arguments[1] === callback;
  }

  return iterationMethods.has(property.name) && node.arguments.some((argument) => argument === callback);
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      loop: 'An assertion in a loop body may run zero times. Assert on the collection, or once after the loop.',
      callback:
        'An assertion in an iteration callback may run zero times. Assert on the collection, or once after the loop.',
    },
  },
  create(context) {
    const imported = new Set<string>();

    return {
      ImportDeclaration(node) {
        if (assertModules.has(String(node.source.value))) {
          for (const specifier of node.specifiers) {
            imported.add(specifier.local.name);
          }
        }
      },
      CallExpression(node) {
        if (!isAssertion(node.callee, imported)) {
          return;
        }

        const ancestors = context.sourceCode.getAncestors(node);
        const boundary = ancestors.findLast((ancestor) => loops.has(ancestor.type) || functions.has(ancestor.type));

        if (boundary === undefined) {
          return;
        }

        if (loops.has(boundary.type)) {
          context.report({ node, messageId: 'loop' });
        } else if (ancestors.some((ancestor) => isIterationCallback(ancestor, boundary))) {
          context.report({ node, messageId: 'callback' });
        }
      },
    };
  },
};

export default rule;
