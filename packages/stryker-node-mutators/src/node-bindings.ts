import type { NodePath, types } from '@babel/core';

import { lzCalleeRoot, lzImportOf } from '@layzee/stryker-mutator-core';
import { lzBuiltin, lzNodeAssert } from './bindings.ts';

const nodeProcess = lzBuiltin('process');

export function isNodeAssertCall(path: NodePath, call: types.CallExpression): boolean {
  const root = lzCalleeRoot(call.callee);
  const source = root && lzImportOf(path, root.name)?.source;

  return source !== undefined && lzNodeAssert.has(source);
}

/** The global `process`, or the default or namespace import of `node:process`. */
export function isProcess(path: NodePath, receiver: types.Node): boolean {
  if (receiver.type !== 'Identifier') {
    return false;
  }

  const from = lzImportOf(path, receiver.name);

  return from === undefined
    ? receiver.name === 'process' && !path.scope.hasBinding('process')
    : nodeProcess.has(from.source) && from.imported === undefined;
}
