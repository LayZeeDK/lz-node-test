import type { Rule } from 'eslint';
import type { Node } from 'estree';

const loops = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const functions = new Set(['ArrowFunctionExpression', 'FunctionExpression']);
const assertModules = new Set(['node:assert', 'node:assert/strict']);
const iterationMethods = new Set([
  'forEach',
  'map',
  'flatMap',
  'every',
  'some',
  'filter',
  'find',
  'findIndex',
  'reduce',
]);

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

function isIterationCall(node: Node): boolean {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.property.type === 'Identifier' &&
    iterationMethods.has(node.callee.property.name)
  );
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
        const boundary = ancestors.findLastIndex(
          (ancestor) => loops.has(ancestor.type) || functions.has(ancestor.type),
        );

        if (boundary === -1) {
          return;
        }

        if (loops.has(ancestors[boundary].type)) {
          context.report({ node, messageId: 'loop' });
        } else if (isIterationCall(ancestors[boundary - 1])) {
          context.report({ node, messageId: 'callback' });
        }
      },
    };
  },
};

export default rule;
