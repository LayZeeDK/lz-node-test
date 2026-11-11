import { resolveEachCore, type LzInstrumenter, type LzListedMutator } from './instrumenter.ts';
import { lzIsOwn, lzToNodeMutator, ownerOf, type LzMutator } from './mutator.ts';
import { lzWarnOutsidePeerRange, parseCaretFloor } from './peer-range.ts';

/** Stryker's `// Stryker disable` directives match mutator names with letters only. */
const namePattern = /^[A-Za-z]+$/;

export type LzInstallMode = 'add' | 'replace';

export interface LzInstallOptions {
  /** The installing package, which starts each error and warning. */
  readonly packageName: string;
  /** The installing package's peer range of `@stryker-mutator/core`, a caret range such as `^10.1.1`. */
  readonly corePeerRange: string;
  readonly mode: LzInstallMode;
  readonly mutators: readonly LzMutator[];
}

/**
 * Puts `mutators` into the mutator list of each copy of Stryker's instrumenter, and throws unless each makes a mutant
 * of its sample: a bundled instrumenter does not read the list and would drop the mutators without a word.
 */
export async function lzInstall(
  { packageName, corePeerRange, mode, mutators }: LzInstallOptions,
  resolve: () => Promise<readonly LzInstrumenter[]> = resolveEachCore,
  warn: (message: string) => void = console.warn,
): Promise<void> {
  const floor = parseCaretFloor(corePeerRange, packageName);
  const instrumenters = await resolve();

  instrumenters.forEach(({ allMutators }) => {
    checkNames(packageName, mutators, allMutators);
  });
  instrumenters.forEach((instrumenter) => {
    putInto(packageName, instrumenter, mode, mutators);
  });
  await Promise.all(instrumenters.map((instrumenter) => selfCheck(packageName, instrumenter, mutators)));
  lzWarnOutsidePeerRange(
    packageName,
    floor,
    instrumenters.map(({ version }) => version),
    warn,
  );
}

/** Replace mode keeps the mutators of the other packages that install through this one. */
function putInto(
  packageName: string,
  instrumenter: LzInstrumenter,
  mode: LzInstallMode,
  mutators: readonly LzMutator[],
): void {
  const { allMutators } = instrumenter;
  const nodeMutators = mutators.map((mutator) => lzToNodeMutator(mutator, instrumenter.types, packageName));

  if (mode === 'replace') {
    instrumenter.setMutators([
      ...allMutators.filter((mutator) => lzIsOwn(mutator) && ownerOf(mutator) !== packageName),
      ...nodeMutators,
    ]);
  } else {
    instrumenter.setMutators([
      ...allMutators,
      ...nodeMutators.filter((mutator) => !allMutators.some(({ name }) => name === mutator.name)),
    ]);
  }
}

function checkNames(packageName: string, mutators: readonly LzMutator[], present: readonly LzListedMutator[]): void {
  const names = mutators.map(({ name }) => name);
  const invalid = names.filter((name) => !namePattern.test(name));

  if (invalid.length > 0) {
    throw new Error(
      `${packageName}: a mutator name has letters only, as Stryker's directives match no other character: ` +
        invalid.map((name) => JSON.stringify(name)).join(', '),
    );
  }

  // Stryker's directives match mutator names ignoring case.
  const keys = names.map((name) => name.toLowerCase());
  const taken = names.filter((name, index) => {
    const key = name.toLowerCase();

    return (
      keys.indexOf(key) !== index ||
      present.some((mutator) => mutator.name.toLowerCase() === key && ownerOf(mutator) !== packageName)
    );
  });

  if (taken.length > 0) {
    throw new Error(`${packageName}: another mutator already has the name ${taken.join(', ')}.`);
  }
}

async function selfCheck(
  packageName: string,
  instrumenter: LzInstrumenter,
  mutators: readonly LzMutator[],
): Promise<void> {
  const mutants = await instrumenter.instrument(
    mutators.map(({ name, sample }) => ({ name: `${name}.self-check.ts`, content: sample })),
  );
  const made = new Set(mutants.map(({ mutatorName }) => mutatorName));
  const missing = mutators.map(({ name }) => name).filter((name) => !made.has(name));

  if (missing.length > 0) {
    throw new Error(
      `${packageName}: the instrumenter in ${instrumenter.dir} made no mutants of ${missing.join(', ')} from ` +
        'their samples, so it does not read the mutator list this module added to. A bundled instrumenter does that.',
    );
  }
}
