import {
  lzIsOwn,
  lzResolveFromCore,
  lzToNodeMutator,
  type LzInstrumentedMutant,
  type LzListedMutator,
  type LzOperator,
} from '@layzee/stryker-mutator-core';

export const strict = "import assert from 'node:assert/strict';\n";

export async function instrumentWith(operator: LzOperator, source: string): Promise<readonly LzInstrumentedMutant[]> {
  const instrumenter = await lzResolveFromCore();

  return instrumenter.instrument(
    [{ name: 'sample.ts', content: source }],
    [lzToNodeMutator(operator, instrumenter.types)],
  );
}

export async function mutantsOf(operator: LzOperator, source: string): Promise<string[]> {
  const mutants = await instrumentWith(operator, source);

  return mutants.map(({ replacement }) => replacement.replace(/\s+/g, ' '));
}

/** The mutator names of the statement removals in `source`: by Stryker's mutators alone, then with `operator` too. */
export async function removalsNextToBuiltIns(operator: LzOperator, source: string): Promise<[string[], string[]]> {
  const instrumenter = await lzResolveFromCore();
  const builtIns = instrumenter.allMutators.filter((mutator) => !lzIsOwn(mutator));
  const removals = async (mutators: readonly LzListedMutator[]) =>
    (await instrumenter.instrument([{ name: 'sample.ts', content: source }], mutators))
      .filter(({ replacement }) => replacement === ';')
      .map(({ mutatorName }) => mutatorName);

  return [await removals(builtIns), await removals([...builtIns, lzToNodeMutator(operator, instrumenter.types)])];
}
