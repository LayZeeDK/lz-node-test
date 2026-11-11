import { lzAllMutators, type LzMutatorSets } from '@layzee/stryker-mutator-core';
import { jsAssignmentStatement } from './js-assignment-statement.ts';
import { jsNumericLiteral } from './js-numeric-literal.ts';

export const jsMutatorSets = {
  defaults: [],
  optIn: [jsNumericLiteral],
  experimental: [jsAssignmentStatement],
} satisfies LzMutatorSets;

export const jsMutators = lzAllMutators(jsMutatorSets);
