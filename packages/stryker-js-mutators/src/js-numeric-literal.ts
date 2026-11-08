import type { NodePath, types } from '@babel/core';

import type { LzBabelTypes, LzOperator } from '@layzee/stryker-mutator-core';

/**
 * Moves an integer literal by 1 each way, as an off-by-one in a limit, an index or a count does. A literal that another
 * mutator mutates keeps only that mutator's mutants, so a mutator of a site, such as a timer's delay, takes precedence.
 * The arguments of a `kill` call and the `uid` and `gid` of an options object are left alone: a mutant there would signal
 * a real process or run one as another user.
 */
export const jsNumericLiteral: LzOperator<'LzJsNumericLiteral'> = {
  name: 'LzJsNumericLiteral',
  sample: 'const limit = 40;\n',
  *mutate(path, t) {
    if (
      path.isNumericLiteral() &&
      Number.isSafeInteger(path.node.value) &&
      !isPropertyKey(path) &&
      !isOctal(path.node) &&
      !isLiteralType(path) &&
      !isKillArgument(path) &&
      !isUserOrGroupId(path)
    ) {
      yield numberNode(t, path.node.value + 1);
      yield numberNode(t, path.node.value - 1);
    }
  },
  filter: (mutantsInScope) => mutantsInScope.every(isOwnMutant),
};

function isOwnMutant(mutant: unknown): boolean {
  return (
    typeof mutant === 'object' &&
    mutant !== null &&
    'mutatorName' in mutant &&
    mutant.mutatorName === jsNumericLiteral.name
  );
}

/** The key of `{ 1: x }` or of a class member names a property, and a computed key such as `{ [1]: x }` does not. */
function isPropertyKey(path: NodePath): boolean {
  const { parent } = path;

  return path.key === 'key' && 'computed' in parent && !parent.computed;
}

/** A file mode, such as `0o600`: 1 more or less gives others access to a real file. */
function isOctal(literal: types.NumericLiteral): boolean {
  const raw = literal.extra?.['raw'];

  return typeof raw === 'string' && raw.toLowerCase().startsWith('0o');
}

function withSign(path: NodePath): NodePath {
  return path.parentPath.isUnaryExpression() ? path.parentPath : path;
}

/** A number type, such as the `1` of `x satisfies 1`, where Stryker places mutants as it places none in other types. */
function isLiteralType(path: NodePath): boolean {
  return withSign(path).parent.type === 'TSLiteralType';
}

/** Anywhere in the arguments of the nearest call of `kill(...)`, `process.kill(...)` or `child.kill(...)`. */
function isKillArgument(path: NodePath): boolean {
  const argument = path.find((current) => isCall(current.parent));
  const call = argument?.parent;

  return argument?.listKey === 'arguments' && isCall(call) && nameOf(call.callee) === 'kill';
}

function isCall(node: types.Node | null | undefined): node is types.CallExpression | types.OptionalCallExpression {
  return node?.type === 'CallExpression' || node?.type === 'OptionalCallExpression';
}

/** The `uid` or `gid` of a spawn option, such as `{ uid: 1000 }`: 1 more or less runs the child as another user. */
function isUserOrGroupId(path: NodePath): boolean {
  const property = withSign(path).parent;

  if (property.type !== 'ObjectProperty' || property.computed) {
    return false;
  }

  const name = property.key.type === 'StringLiteral' ? property.key.value : nameOf(property.key);

  return name === 'uid' || name === 'gid';
}

/** The name a callee or a property key stands for, such as `kill` in `process.kill` or `process['kill']`. */
function nameOf(node: types.Node): string | undefined {
  if (node.type === 'Identifier') {
    return node.name;
  }

  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') {
    return undefined;
  }

  const { property } = node;

  if (property.type === 'PrivateName') {
    return property.id.name;
  }

  if (property.type === 'Identifier' && !node.computed) {
    return property.name;
  }

  return property.type === 'StringLiteral' ? property.value : undefined;
}

/** Babel's numericLiteral takes no negative number. */
function numberNode(t: LzBabelTypes, value: number): types.Expression {
  return value < 0 ? t.unaryExpression('-', t.numericLiteral(-value)) : t.numericLiteral(value);
}
