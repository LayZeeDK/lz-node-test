import {
  lzResolveFromCore,
  lzToNodeMutator,
  type LzInstrumentedMutant,
  type LzOperator,
} from '@layzee/stryker-mutator-core';
import { lzPackageName } from '../src/package-name.ts';

export const strict = "import assert from 'node:assert/strict';\n";

export async function instrumentWith(operator: LzOperator, source: string): Promise<readonly LzInstrumentedMutant[]> {
  const instrumenter = await lzResolveFromCore();

  return instrumenter.instrument(
    [{ name: 'sample.ts', content: source }],
    [lzToNodeMutator(operator, instrumenter.types, lzPackageName)],
  );
}

export async function mutantsOf(operator: LzOperator, source: string): Promise<string[]> {
  const mutants = await instrumentWith(operator, source);

  return mutants.map(({ replacement }) => replacement.replace(/\s+/g, ' '));
}
