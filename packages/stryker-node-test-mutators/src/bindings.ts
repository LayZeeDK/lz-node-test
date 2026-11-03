import type { NodePath, types } from '@babel/core';

import { lzCalleeRoot, lzImportOf, lzPropertyName } from '@layzee/stryker-mutator-core';

export const nodeAssert = lzBuiltin('assert', 'assert/strict');
const nodeProcess = lzBuiltin('process');

export function lzBuiltin(...names: readonly string[]): ReadonlySet<string> {
  return new Set(names.flatMap((name) => [name, `node:${name}`]));
}

export function assertMethod(path: NodePath, callee: types.Node): string | undefined {
  const root = lzCalleeRoot(callee);

  if (root === undefined) {
    return undefined;
  }

  const from = lzImportOf(path, root.name);

  if (from === undefined) {
    return isTestContextAssert(path, callee, root) ? lzPropertyName(callee) : undefined;
  }

  if (!nodeAssert.has(from.source)) {
    return undefined;
  }

  return callee === root ? (from.imported ?? 'ok') : lzPropertyName(callee);
}

function isTestContextAssert(path: NodePath, callee: types.Node, root: types.Identifier): boolean {
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'MemberExpression' &&
    callee.object.object === root &&
    lzPropertyName(callee.object) === 'assert' &&
    isTestContext(path, root)
  );
}

/** A parameter, which node:test passes the test context in. */
export function isTestContext(path: NodePath, identifier: types.Identifier): boolean {
  return path.scope.getBinding(identifier.name)?.kind === 'param';
}

export function isNodeAssertCall(path: NodePath, call: types.CallExpression): boolean {
  const root = lzCalleeRoot(call.callee);
  const source = root && lzImportOf(path, root.name)?.source;

  return source !== undefined && nodeAssert.has(source);
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
