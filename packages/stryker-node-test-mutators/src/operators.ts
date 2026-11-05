import type { LzOperatorSets } from '@layzee/stryker-mutator-core';
import { nodeTestAssertCall } from './node-test-assert-call.ts';
import { nodeTestAssertValidator } from './node-test-assert-validator.ts';
import { nodeTestCatchAssert } from './node-test-catch-assert.ts';

export const testOperatorSets: LzOperatorSets = {
  defaults: [nodeTestAssertCall, nodeTestAssertValidator],
  optIn: [],
  experimental: [nodeTestCatchAssert],
};

export const testOperators = [
  ...testOperatorSets.defaults,
  ...testOperatorSets.optIn,
  ...testOperatorSets.experimental,
];
