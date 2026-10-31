import type { NodePath, types } from '@babel/core';

import { isProcess } from './bindings.ts';
import type { Operator } from './operator.ts';

/**
 * Flips the exit status that `process.exitCode = N` sets: a failure becomes a success and a success a failure. Stryker
 * mutates no number, so a CLI's exit status otherwise goes untested.
 */
export const nodeExitCode: Operator = {
  name: 'LzNodeExitCode',
  sample: 'process.exitCode = 1;\n',
  *mutate(path, t) {
    const assignment = path.parent;

    if (
      path.isNumericLiteral() &&
      path.key === 'right' &&
      assignment.type === 'AssignmentExpression' &&
      assignment.operator === '=' &&
      isExitCode(path, assignment.left)
    ) {
      yield t.numericLiteral(path.node.value === 0 ? 1 : 0);
    }
  },
};

function isExitCode(path: NodePath, target: types.Node): boolean {
  return (
    target.type === 'MemberExpression' &&
    !target.computed &&
    target.property.type === 'Identifier' &&
    target.property.name === 'exitCode' &&
    isProcess(path, target.object)
  );
}
