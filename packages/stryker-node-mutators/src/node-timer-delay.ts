import type { NodePath, types } from '@babel/core';

import { lzImportOf, lzPropertyName, type LzOperator } from '@layzee/stryker-mutator-core';
import { lzBuiltin } from './bindings.ts';

const timers: ReadonlySet<string | undefined> = new Set(['setTimeout', 'setInterval']);
const nodeTimers = lzBuiltin('timers');
const nodeTimersPromises = lzBuiltin('timers/promises');

/**
 * Moves a timer's delay by 1 ms each way. Node.js runs a delay below 1 after 1 ms, so the moves of a literal 0, 1 or
 * negative number that leave the delay Node.js runs unchanged are left out. A string delay is left out too, as `+ 1`
 * would append.
 */
export const nodeTimerDelay: LzOperator = {
  name: 'LzNodeTimerDelay',
  sample: 'setTimeout(() => {}, 10);\n',
  *mutate(path, t) {
    if (
      !path.isExpression() ||
      path.isIdentifier({ name: 'undefined' }) ||
      path.isStringLiteral() ||
      path.isTemplateLiteral() ||
      (path.isUnaryExpression({ operator: '-' }) && path.get('argument').isNumericLiteral()) ||
      !isDelay(path)
    ) {
      return;
    }

    const literal = path.isNumericLiteral() ? path.node.value : undefined;

    if (literal !== 0) {
      yield t.binaryExpression('+', t.cloneNode(path.node), t.numericLiteral(1));
    }

    if (literal !== 0 && literal !== 1) {
      yield t.binaryExpression('-', t.cloneNode(path.node), t.numericLiteral(1));
    }
  },
};

function isDelay(path: NodePath): boolean {
  const call = path.parent;

  return call.type === 'CallExpression' && delayIndex(path, call.callee) === path.key;
}

function delayIndex(path: NodePath, callee: types.Node): number | undefined {
  if (callee.type === 'Identifier') {
    const from = lzImportOf(path, callee.name);

    if (from === undefined) {
      return timers.has(callee.name) && !path.scope.hasBinding(callee.name) ? 1 : undefined;
    }

    return timers.has(from.imported) ? timersDelayIndex(from.source) : undefined;
  }

  if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') {
    return undefined;
  }

  const from = lzImportOf(path, callee.object.name);
  const method = lzPropertyName(callee);

  if (from === undefined) {
    return undefined;
  }

  if (from.imported === undefined) {
    return timers.has(method) ? timersDelayIndex(from.source) : undefined;
  }

  return from.imported === 'scheduler' && method === 'wait' && nodeTimersPromises.has(from.source) ? 0 : undefined;
}

function timersDelayIndex(source: string): number | undefined {
  return nodeTimers.has(source) ? 1 : nodeTimersPromises.has(source) ? 0 : undefined;
}
