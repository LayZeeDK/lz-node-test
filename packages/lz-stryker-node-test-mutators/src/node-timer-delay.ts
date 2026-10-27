import type { NodePath, types } from '@babel/core';

import { importOf } from './bindings.ts';
import type { Operator } from './operator.ts';

const timers: ReadonlySet<string | undefined> = new Set(['setTimeout', 'setInterval']);
const nodeTimers: ReadonlySet<string> = new Set(['node:timers', 'timers']);
const nodeTimersPromises: ReadonlySet<string> = new Set(['node:timers/promises', 'timers/promises']);

/**
 * Moves a timer's delay by 1 ms each way. Node.js runs a delay below 1 after 1 ms, so the moves that leave a delay of
 * 0 or 1 at that are left out.
 */
export const nodeTimerDelay: Operator = {
  name: 'LzNodeTimerDelay',
  sample: 'setTimeout(() => {}, 10);\n',
  *mutate(path, t) {
    if (!path.isExpression() || path.isIdentifier({ name: 'undefined' }) || !isDelay(path)) {
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
    const from = importOf(path, callee.name);

    if (from === undefined) {
      return timers.has(callee.name) && !path.scope.hasBinding(callee.name) ? 1 : undefined;
    }

    return timers.has(from.imported) ? timersDelayIndex(from.source) : undefined;
  }

  if (
    callee.type !== 'MemberExpression' ||
    callee.object.type !== 'Identifier' ||
    callee.property.type !== 'Identifier'
  ) {
    return undefined;
  }

  const from = importOf(path, callee.object.name);
  const method = callee.property.name;

  if (from?.imported === undefined) {
    return from !== undefined && timers.has(method) ? timersDelayIndex(from.source) : undefined;
  }

  return from.imported === 'scheduler' && method === 'wait' && nodeTimersPromises.has(from.source) ? 0 : undefined;
}

function timersDelayIndex(source: string): number | undefined {
  return nodeTimers.has(source) ? 1 : nodeTimersPromises.has(source) ? 0 : undefined;
}
