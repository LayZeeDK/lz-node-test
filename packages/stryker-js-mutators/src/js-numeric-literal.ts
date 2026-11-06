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
      !isPropertyName(path) &&
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
function isPropertyName(path: NodePath): boolean {
  const { parent } = path;

  return path.key === 'key' && 'computed' in parent && !parent.computed;
}

/** A process id or a signal of `kill(...)`, `process.kill(...)` or `child.kill(...)`, also behind a minus sign. */
function isKillArgument(path: NodePath): boolean {
  const argument = path.parentPath.isUnaryExpression() ? path.parentPath : path;
  const call = argument.parent;

  return (
    (call.type === 'CallExpression' || call.type === 'OptionalCallExpression') && calleeName(call.callee) === 'kill'
  );
}

function calleeName(callee: types.Node): string | undefined {
  if (callee.type === 'Identifier') {
    return callee.name;
  }

  return (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') &&
    !callee.computed &&
    callee.property.type === 'Identifier'
    ? callee.property.name
    : undefined;
}

/** Babel's numericLiteral takes no negative number. */
function numberNode(t: LzBabelTypes, value: number): types.Expression {
  return value < 0 ? t.unaryExpression('-', t.numericLiteral(-value)) : t.numericLiteral(value);
}
