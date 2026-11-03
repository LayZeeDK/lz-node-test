import type { LzOperator } from '@layzee/stryker-mutator-core';
import { nodeTestAssertCall } from './node-test-assert-call.ts';
import { nodeTestAssertValidator } from './node-test-assert-validator.ts';

export const testOperators: readonly LzOperator[] = [nodeTestAssertCall, nodeTestAssertValidator];
