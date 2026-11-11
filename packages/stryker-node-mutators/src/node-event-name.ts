import type { NodePath, types } from '@babel/core';

import { lzImportOf, lzPropertyName, type LzMutator } from '@layzee/stryker-mutator-core';
import { lzBuiltin } from './bindings.ts';
import { isProcess } from './node-bindings.ts';

const listenMethods: ReadonlySet<string | undefined> = new Set([
  'on',
  'once',
  'addListener',
  'prependListener',
  'prependOnceListener',
]);
const nodeEvents = lzBuiltin('events');
const processSwaps: ReadonlyMap<string, readonly string[]> = new Map([
  ['exit', ['beforeExit']],
  ['beforeExit', ['exit']],
]);
const streamSwaps: ReadonlyMap<string, readonly string[]> = new Map([
  ['close', ['exit']],
  ['exit', ['close']],
  ['finish', ['end', 'close']],
  ['end', ['close']],
]);

/**
 * Swaps a lifecycle event that a listener waits for with one that fires at another time, such as a child process's
 * `exit`, which can fire while its output is still open, and its `close`.
 */
export const nodeEventName: LzMutator = {
  name: 'LzNodeEventName',
  sample: "child.on('exit', () => {});\n",
  *mutate(path, t) {
    if (!path.isStringLiteral()) {
      return;
    }

    const receiver = receiverOf(path);

    if (receiver === undefined) {
      return;
    }

    const swaps = isProcess(path, receiver) ? processSwaps : streamSwaps;

    for (const name of swaps.get(path.node.value) ?? []) {
      yield t.stringLiteral(name);
    }
  },
};

function receiverOf(path: NodePath): types.Node | undefined {
  const call = path.parent;

  if (call.type !== 'CallExpression') {
    return undefined;
  }

  if (isEventsFunction(path, call.callee)) {
    return path.key === 1 ? call.arguments[0] : undefined;
  }

  const { callee } = call;
  const listens = callee.type === 'MemberExpression' && listenMethods.has(lzPropertyName(callee));

  return listens && path.key === 0 ? callee.object : undefined;
}

function isEventsFunction(path: NodePath, callee: types.Node): boolean {
  if (callee.type === 'Identifier') {
    const from = lzImportOf(path, callee.name);

    return from !== undefined && nodeEvents.has(from.source) && isOnceOrOn(from.imported);
  }

  if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') {
    return false;
  }

  const from = lzImportOf(path, callee.object.name);

  return (
    from !== undefined &&
    nodeEvents.has(from.source) &&
    (from.imported === undefined || from.imported === 'EventEmitter') &&
    isOnceOrOn(lzPropertyName(callee))
  );
}

function isOnceOrOn(name: string | undefined): boolean {
  return name === 'once' || name === 'on';
}
