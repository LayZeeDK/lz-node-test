import type { LzOperator } from '@layzee/stryker-mutator-core';

/**
 * Removes an assignment statement, such as `x = y;` or `obj.k = v;`, which no mutator of Stryker's removes. Like
 * Stryker's removal of a call statement, it is dropped when another mutant shares the statement, as in `x = true;`.
 */
export const jsAssignmentStatement: LzOperator<'LzJsAssignmentStatement'> = {
  name: 'LzJsAssignmentStatement',
  sample: 'x = y;\n',
  *mutate(path, t) {
    if (path.isExpressionStatement() && path.get('expression').isAssignmentExpression({ operator: '=' })) {
      yield t.emptyStatement();
    }
  },
  filter: (mutantsInScope) => mutantsInScope.length === 1,
};
