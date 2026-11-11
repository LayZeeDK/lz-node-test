import {
  lzResolveFromCore,
  lzToNodeMutator,
  type LzInstrumentedMutant,
  type LzMutator,
} from '@layzee/stryker-mutator-core';
import { lzPackageName } from '../src/package-name.ts';

export const strict = "import assert from 'node:assert/strict';\n";

export async function instrumentWith(mutator: LzMutator, source: string): Promise<readonly LzInstrumentedMutant[]> {
  const instrumenter = await lzResolveFromCore();

  return instrumenter.instrument(
    [{ name: 'sample.ts', content: source }],
    [lzToNodeMutator(mutator, instrumenter.types, lzPackageName)],
  );
}

export async function mutantsOf(mutator: LzMutator, source: string): Promise<string[]> {
  const mutants = await instrumentWith(mutator, source);

  return mutants.map(({ replacement }) => replacement.replace(/\s+/g, ' '));
}
