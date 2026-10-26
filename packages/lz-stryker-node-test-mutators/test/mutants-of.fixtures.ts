import { resolveFromCore } from '../src/install.ts';
import { toNodeMutator, type Operator } from '../src/operator.ts';

export async function mutantsOf(operator: Operator, source: string): Promise<string[]> {
  const instrumenter = await resolveFromCore();
  const mutants = await instrumenter.instrument(
    [{ name: 'sample.ts', content: source }],
    [toNodeMutator(operator, instrumenter.types)],
  );

  return mutants.map(({ replacement }) => replacement.replace(/\s+/g, ' '));
}
