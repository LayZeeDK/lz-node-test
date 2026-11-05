import { lzAllOperators, type LzOperatorSets } from '@layzee/stryker-mutator-core';
import { nodeTestAssertCall } from './node-test-assert-call.ts';
import { nodeTestAssertValidator } from './node-test-assert-validator.ts';
import { nodeTestCatchAssert } from './node-test-catch-assert.ts';

export const testOperatorSets = {
  defaults: [nodeTestAssertCall, nodeTestAssertValidator],
  optIn: [],
  experimental: [nodeTestCatchAssert],
} satisfies LzOperatorSets;

export const testOperators = lzAllOperators(testOperatorSets);
