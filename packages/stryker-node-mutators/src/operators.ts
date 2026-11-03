import type { LzOperator } from '@layzee/stryker-mutator-core';
import { nodeAssertStatement } from './node-assert-statement.ts';
import { nodeAwaitStatement } from './node-await-statement.ts';
import { nodeEventName } from './node-event-name.ts';
import { nodeExitCode } from './node-exit-code.ts';
import { nodeReturnAwait } from './node-return-await.ts';
import { nodeTimerDelay } from './node-timer-delay.ts';

export const productionOperators: readonly LzOperator[] = [
  nodeTimerDelay,
  nodeEventName,
  nodeAssertStatement,
  nodeAwaitStatement,
  nodeReturnAwait,
  nodeExitCode,
];
