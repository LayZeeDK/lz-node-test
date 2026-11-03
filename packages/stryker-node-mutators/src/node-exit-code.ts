import type { NodePath, types } from '@babel/core';

import { lzPropertyName, type LzOperator } from '@layzee/stryker-mutator-core';
import { isProcess } from './node-bindings.ts';

/**
 * Flips the exit status that `process.exitCode = N` sets: a failure becomes a success and a success a failure. Stryker
 * mutates no number, so a CLI's exit status otherwise goes untested.
 */
export const nodeExitCode: LzOperator = {
  name: 'LzNodeExitCode',
  sample: 'process.exitCode = 1;\n',
  *mutate(path, t) {
    const assignment = path.parent;

    if (
      !path.isNumericLiteral() ||
      assignment.type !== 'AssignmentExpression' ||
      assignment.operator !== '=' ||
      !isExitCode(path, assignment.left)
    ) {
      return;
    }

    yield t.numericLiteral(path.node.value === 0 ? 1 : 0);
  },
};

function isExitCode(path: NodePath, target: types.Node): boolean {
  return target.type === 'MemberExpression' && lzPropertyName(target) === 'exitCode' && isProcess(path, target.object);
}
