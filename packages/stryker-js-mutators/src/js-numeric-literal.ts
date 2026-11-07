import type { NodePath, types } from '@babel/core';

import type { LzBabelTypes, LzOperator } from '@layzee/stryker-mutator-core';

/**
 * Moves an integer literal by 1 each way, as an off-by-one in a limit, an index or a count does. A literal that another
 * mutator mutates keeps only that mutator's mutants, so a mutator of a site, such as a timer's delay, takes precedence.
 * The arguments of a `kill` call are left alone: a mutant there would signal a real process.
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
      !isKillArgument(path)
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

/** A process id or a signal of `kill(...)`, `process.kill(...)` or `child.kill(...)`, also behind a minus sign. */
function isKillArgument(path: NodePath): boolean {
  const call = withSign(path).parent;

  return (
    (call.type === 'CallExpression' || call.type === 'OptionalCallExpression') && calleeName(call.callee) === 'kill'
  );
}

function calleeName(callee: types.Node): string | undefined {
  if (callee.type === 'Identifier') {
    return callee.name;
  }

  if ((callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') || callee.computed) {
    return undefined;
  }

  const { property } = callee;

  return property.type === 'PrivateName' ? property.id.name : property.name;
}

/** Babel's numericLiteral takes no negative number. */
function numberNode(t: LzBabelTypes, value: number): types.Expression {
  return value < 0 ? t.unaryExpression('-', t.numericLiteral(-value)) : t.numericLiteral(value);
}
