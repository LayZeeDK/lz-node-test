import { resolveFromCore, type InstrumentedMutant } from '../src/install.ts';
import { toNodeMutator, type Operator } from '../src/operator.ts';

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
