import { resolveEachCore, type Instrumenter, type ListedMutator } from './instrumenter.ts';
import { isOwn, toNodeMutator, type Operator } from './operator.ts';
import { lzPackageName } from './package-name.ts';
import { lzWarnOutsidePeerRange } from './peer-range.ts';

/** Stryker's `// Stryker disable` directives match mutator names with letters only. */
const namePattern = /^[A-Za-z]+$/;

type Mode = 'add' | 'replace';

/**
 * Puts `operators` into the mutator list of each copy of Stryker's instrumenter, and throws unless each makes a mutant
 * of its sample: a bundled instrumenter does not read the list and would drop the operators without a word.
 */
export async function install(
  mode: Mode,
  operators: readonly Operator[],
  resolve: () => Promise<readonly Instrumenter[]> = resolveEachCore,
  warn: (message: string) => void = console.warn,
): Promise<void> {
  const instrumenters = await resolve();

  instrumenters.forEach(({ allMutators }) => {
    checkNames(operators, allMutators);
  });
  instrumenters.forEach((instrumenter) => {
    putInto(instrumenter, mode, operators);
  });
  await Promise.all(instrumenters.map((instrumenter) => selfCheck(instrumenter, operators)));
  lzWarnOutsidePeerRange(
    instrumenters.map(({ version }) => version),
    warn,
  );
}

function putInto(instrumenter: Instrumenter, mode: Mode, operators: readonly Operator[]): void {
  const { allMutators } = instrumenter;
  const mutators = operators.map((operator) => toNodeMutator(operator, instrumenter.types));

  if (mode === 'replace') {
    instrumenter.setMutators(mutators);
  } else {
    instrumenter.setMutators([
      ...allMutators,
      ...mutators.filter((mutator) => !allMutators.some(({ name }) => name === mutator.name)),
    ]);
  }
}

function checkNames(operators: readonly Operator[], present: readonly ListedMutator[]): void {
  const names = operators.map(({ name }) => name);
  const invalid = names.filter((name) => !namePattern.test(name));

  if (invalid.length > 0) {
    throw new Error(
      `${lzPackageName}: a mutator name has letters only, as Stryker's directives match no other character: ` +
        invalid.map((name) => JSON.stringify(name)).join(', '),
    );
  }

  // Stryker's directives match mutator names ignoring case.
  const keys = names.map((name) => name.toLowerCase());
  const taken = names.filter((name, index) => {
    const key = name.toLowerCase();

    return (
      keys.indexOf(key) !== index || present.some((mutator) => mutator.name.toLowerCase() === key && !isOwn(mutator))
    );
  });

  if (taken.length > 0) {
    throw new Error(`${lzPackageName}: another mutator already has the name ${taken.join(', ')}.`);
  }
}

async function selfCheck(instrumenter: Instrumenter, operators: readonly Operator[]): Promise<void> {
  const mutants = await instrumenter.instrument(
    operators.map(({ name, sample }) => ({ name: `${name}.self-check.ts`, content: sample })),
  );
  const made = new Set(mutants.map(({ mutatorName }) => mutatorName));
  const missing = operators.map(({ name }) => name).filter((name) => !made.has(name));

  if (missing.length > 0) {
    throw new Error(
      `${lzPackageName}: the instrumenter in ${instrumenter.dir} made no mutants of ${missing.join(', ')} from ` +
        'their samples, so it does not read the mutator list this module added to. A bundled instrumenter does that.',
    );
  }
}
