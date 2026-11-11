import {
  lzIsOwn,
  lzResolveFromCore,
  lzToNodeMutator,
  type LzInstrumentedMutant,
  type LzListedMutator,
  type LzMutator,
} from '@layzee/stryker-mutator-core';
import { lzPackageName } from '../src/package-name.ts';

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

/** The mutator name and replacement of each mutant that `mutators` make together in `source`. */
export async function mutantsOfAll(mutators: readonly LzMutator[], source: string): Promise<string[][]> {
  const instrumenter = await lzResolveFromCore();
  const mutants = await instrumenter.instrument(
    [{ name: 'sample.ts', content: source }],
    mutators.map((mutator) => lzToNodeMutator(mutator, instrumenter.types, lzPackageName)),
  );

  return mutants.map(({ mutatorName, replacement }) => [mutatorName, replacement]);
}

/** The mutator names of the statement removals in `source`: by Stryker's mutators alone, then with `mutator` too. */
export async function removalsNextToBuiltIns(mutator: LzMutator, source: string): Promise<[string[], string[]]> {
  const instrumenter = await lzResolveFromCore();
  const builtIns = instrumenter.allMutators.filter((listed) => !lzIsOwn(listed));
  const removals = async (mutators: readonly LzListedMutator[]) =>
    (await instrumenter.instrument([{ name: 'sample.ts', content: source }], mutators))
      .filter(({ replacement }) => replacement === ';')
      .map(({ mutatorName }) => mutatorName);

  return [
    await removals(builtIns),
    await removals([...builtIns, lzToNodeMutator(mutator, instrumenter.types, lzPackageName)]),
  ];
}
