import { resolveFromCore, type InstrumentedMutant, type ListedMutator } from '../src/install.ts';
import { isOwn, toNodeMutator, type Operator } from '../src/operator.ts';

export const strict = "import assert from 'node:assert/strict';\n";

export async function instrumentWith(operator: Operator, source: string): Promise<readonly InstrumentedMutant[]> {
  const instrumenter = await resolveFromCore();

  return instrumenter.instrument(
    [{ name: 'sample.ts', content: source }],
    [toNodeMutator(operator, instrumenter.types)],
  );
}

export async function mutantsOf(operator: Operator, source: string): Promise<string[]> {
  const mutants = await instrumentWith(operator, source);

  return mutants.map(({ replacement }) => replacement.replace(/\s+/g, ' '));
}

/** The mutator names of the statement removals in `source`: by Stryker's mutators alone, then with `operator` too. */
export async function removalsNextToBuiltIns(operator: Operator, source: string): Promise<[string[], string[]]> {
  const instrumenter = await resolveFromCore();
  const builtIns = instrumenter.allMutators.filter((mutator) => !isOwn(mutator));
  const removals = async (mutators: readonly ListedMutator[]) =>
    (await instrumenter.instrument([{ name: 'sample.ts', content: source }], mutators))
      .filter(({ replacement }) => replacement === ';')
      .map(({ mutatorName }) => mutatorName);

  return [await removals(builtIns), await removals([...builtIns, toNodeMutator(operator, instrumenter.types)])];
}
