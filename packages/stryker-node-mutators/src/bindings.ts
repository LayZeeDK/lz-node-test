// Installs nothing: packages that build node:assert mutators import this module.
import type { NodePath, types } from '@babel/core';

import { lzCalleeRoot, lzImportOf, lzPropertyName } from '@layzee/stryker-mutator-core';

/** The module names that `node:<name>` and the bare `<name>` of each of `names` resolve to. */
export function lzBuiltin(...names: readonly string[]): ReadonlySet<string> {
  return new Set(names.flatMap((name) => [name, `node:${name}`]));
}

/** The module names of node:assert. */
export const lzNodeAssert = lzBuiltin('assert', 'assert/strict');

/**
 * The node:assert method that a call of `callee` runs, `ok` for a call of the module itself, or `undefined` when the
 * call is no node:assert call. The `assert` of a node:test test context, a parameter, counts.
 */
export function lzAssertMethod(path: NodePath, callee: types.Node): string | undefined {
  const root = lzCalleeRoot(callee);

  if (root === undefined) {
    return undefined;
  }

  const from = lzImportOf(path, root.name);

  if (from === undefined) {
    return isTestContextAssert(path, callee, root) ? lzPropertyName(callee) : undefined;
  }

  if (!lzNodeAssert.has(from.source)) {
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
    path.scope.getBinding(root.name)?.kind === 'param'
  );
}
