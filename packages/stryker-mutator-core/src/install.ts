import { resolveEachCore, type LzInstrumenter, type LzListedMutator } from './instrumenter.ts';
import { lzIsOwn, lzToNodeMutator, type LzOperator } from './operator.ts';
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
  readonly operators: readonly LzOperator[];
}

/**
 * Puts `operators` into the mutator list of each copy of Stryker's instrumenter, and throws unless each makes a mutant
 * of its sample: a bundled instrumenter does not read the list and would drop the operators without a word.
 */
export async function lzInstall(
  { packageName, corePeerRange, mode, operators }: LzInstallOptions,
  resolve: () => Promise<readonly LzInstrumenter[]> = resolveEachCore,
  warn: (message: string) => void = console.warn,
): Promise<void> {
  const floor = parseCaretFloor(corePeerRange, packageName);
  const instrumenters = await resolve();

  instrumenters.forEach(({ allMutators }) => {
    checkNames(packageName, operators, allMutators);
  });
  instrumenters.forEach((instrumenter) => {
    putInto(instrumenter, mode, operators);
  });
  await Promise.all(instrumenters.map((instrumenter) => selfCheck(packageName, instrumenter, operators)));
  lzWarnOutsidePeerRange(
    packageName,
    floor,
    instrumenters.map(({ version }) => version),
    warn,
  );
}

function putInto(instrumenter: LzInstrumenter, mode: LzInstallMode, operators: readonly LzOperator[]): void {
  const { allMutators } = instrumenter;
  const mutators = operators.map((operator) => lzToNodeMutator(operator, instrumenter.types));

  if (mode === 'replace') {
    instrumenter.setMutators(mutators);
  } else {
    instrumenter.setMutators([
      ...allMutators,
      ...mutators.filter((mutator) => !allMutators.some(({ name }) => name === mutator.name)),
    ]);
  }
}

function checkNames(packageName: string, operators: readonly LzOperator[], present: readonly LzListedMutator[]): void {
  const names = operators.map(({ name }) => name);
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
      keys.indexOf(key) !== index || present.some((mutator) => mutator.name.toLowerCase() === key && !lzIsOwn(mutator))
    );
  });

  if (taken.length > 0) {
    throw new Error(`${packageName}: another mutator already has the name ${taken.join(', ')}.`);
  }
}

async function selfCheck(
  packageName: string,
  instrumenter: LzInstrumenter,
  operators: readonly LzOperator[],
): Promise<void> {
  const mutants = await instrumenter.instrument(
    operators.map(({ name, sample }) => ({ name: `${name}.self-check.ts`, content: sample })),
  );
  const made = new Set(mutants.map(({ mutatorName }) => mutatorName));
  const missing = operators.map(({ name }) => name).filter((name) => !made.has(name));

  if (missing.length > 0) {
    throw new Error(
      `${packageName}: the instrumenter in ${instrumenter.dir} made no mutants of ${missing.join(', ')} from ` +
        'their samples, so it does not read the mutator list this module added to. A bundled instrumenter does that.',
    );
  }
}
