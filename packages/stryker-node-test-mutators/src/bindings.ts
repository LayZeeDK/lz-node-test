import type { NodePath, types } from '@babel/core';

export const nodeAssert = lzBuiltin('assert', 'assert/strict');
const nodeProcess = lzBuiltin('process');

export function lzBuiltin(...names: readonly string[]): ReadonlySet<string> {
  return new Set(names.flatMap((name) => [name, `node:${name}`]));
}

interface ImportOf {
  readonly source: string;
  readonly imported: string | undefined;
}

/** Only ES module `import` declarations count: the operators do not read CommonJS `require`. */
export function importOf(path: NodePath, name: string): ImportOf | undefined {
  const bound = path.scope.getBinding(name)?.path;

  if (bound?.parent.type !== 'ImportDeclaration') {
    return undefined;
  }

  const { parent: declaration, node: specifier } = bound;

  return {
    source: declaration.source.value,
    imported: specifier.type === 'ImportSpecifier' ? exportedName(specifier.imported) : undefined,
  };
}

function exportedName(imported: types.Identifier | types.StringLiteral): string {
  return imported.type === 'Identifier' ? imported.name : imported.value;
}

export function assertMethod(path: NodePath, callee: types.Node): string | undefined {
  const root = calleeRoot(callee);

  if (root === undefined) {
    return undefined;
  }

  const from = importOf(path, root.name);

  if (from === undefined) {
    return isTestContextAssert(path, callee, root) ? propertyName(callee) : undefined;
  }

  if (!nodeAssert.has(from.source)) {
    return undefined;
  }

  return callee === root ? (from.imported ?? 'ok') : propertyName(callee);
}

function isTestContextAssert(path: NodePath, callee: types.Node, root: types.Identifier): boolean {
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'MemberExpression' &&
    callee.object.object === root &&
    propertyName(callee.object) === 'assert' &&
    isTestContext(path, root)
  );
}

/** A parameter, which node:test passes the test context in. */
export function isTestContext(path: NodePath, identifier: types.Identifier): boolean {
  return path.scope.getBinding(identifier.name)?.kind === 'param';
}

export function propertyName(member: types.Node): string | undefined {
  return member.type === 'MemberExpression' && !member.computed && member.property.type === 'Identifier'
    ? member.property.name
    : undefined;
}

export function isNodeAssertCall(path: NodePath, call: types.CallExpression): boolean {
  const root = calleeRoot(call.callee);
  const source = root && importOf(path, root.name)?.source;

  return source !== undefined && nodeAssert.has(source);
}

/** The global `process`, or the default or namespace import of `node:process`. */
export function isProcess(path: NodePath, receiver: types.Node): boolean {
  if (receiver.type !== 'Identifier') {
    return false;
  }

  const from = importOf(path, receiver.name);

  return from === undefined
    ? receiver.name === 'process' && !path.scope.hasBinding('process')
    : nodeProcess.has(from.source) && from.imported === undefined;
}

export function awaited(expression: types.Expression): types.Expression {
  return expression.type === 'AwaitExpression' ? expression.argument : expression;
}

export function calleeRoot(callee: types.Node): types.Identifier | undefined {
  if (callee.type === 'MemberExpression') {
    return calleeRoot(callee.object);
  }

  return callee.type === 'Identifier' ? callee : undefined;
}
