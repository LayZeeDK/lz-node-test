import { lzAllOperators, type LzOperatorSets } from '@layzee/stryker-mutator-core';
import { jsAssignmentStatement } from './js-assignment-statement.ts';

export const jsOperatorSets = {
  defaults: [],
  optIn: [],
  experimental: [jsAssignmentStatement],
} satisfies LzOperatorSets;

export const jsOperators = lzAllOperators(jsOperatorSets);
