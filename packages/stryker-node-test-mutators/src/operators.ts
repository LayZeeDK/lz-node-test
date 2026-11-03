import type { LzOperator } from '@layzee/stryker-mutator-core';
import { assertCall } from './assert-call.ts';
import { assertStatement } from './assert-statement.ts';
import { assertValidator } from './assert-validator.ts';
import { awaitStatement } from './await-statement.ts';
import { nodeEventName } from './node-event-name.ts';
import { nodeExitCode } from './node-exit-code.ts';
import { nodeTimerDelay } from './node-timer-delay.ts';
import { returnAwait } from './return-await.ts';

export const productionOperators: readonly LzOperator[] = [
  nodeTimerDelay,
  nodeEventName,
  assertStatement,
  awaitStatement,
  returnAwait,
  nodeExitCode,
];

export const testOperators: readonly LzOperator[] = [assertCall, assertValidator];

export function operatorsFor(name: string): readonly LzOperator[] {
  return name.endsWith('.test.ts') ? testOperators : productionOperators;
}
