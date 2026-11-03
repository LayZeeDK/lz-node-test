import type { LzOperator } from '@layzee/stryker-mutator-core';
import { nodeAssertStatement } from './node-assert-statement.ts';
import { nodeAwaitStatement } from './node-await-statement.ts';
import { nodeEventName } from './node-event-name.ts';
import { nodeExitCode } from './node-exit-code.ts';
import { nodeReturnAwait } from './node-return-await.ts';
import { nodeTestAssertCall } from './node-test-assert-call.ts';
import { nodeTestAssertValidator } from './node-test-assert-validator.ts';
import { nodeTimerDelay } from './node-timer-delay.ts';

export const productionOperators: readonly LzOperator[] = [
  nodeTimerDelay,
  nodeEventName,
  nodeAssertStatement,
  nodeAwaitStatement,
  nodeReturnAwait,
  nodeExitCode,
];

export const testOperators: readonly LzOperator[] = [nodeTestAssertCall, nodeTestAssertValidator];

export function operatorsFor(name: string): readonly LzOperator[] {
  return name.endsWith('.test.ts') ? testOperators : productionOperators;
}
