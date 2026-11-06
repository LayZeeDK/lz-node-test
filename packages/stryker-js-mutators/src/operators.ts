import { lzAllOperators, type LzOperatorSets } from '@layzee/stryker-mutator-core';
import { jsAssignmentStatement } from './js-assignment-statement.ts';
import { jsNumericLiteral } from './js-numeric-literal.ts';

export const jsOperatorSets = {
  defaults: [],
  optIn: [jsNumericLiteral],
  experimental: [jsAssignmentStatement],
} satisfies LzOperatorSets;

export const jsOperators = lzAllOperators(jsOperatorSets);
