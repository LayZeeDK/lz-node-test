// The one module that reaches into Stryker's internals: no other module of this package names a file of
// @stryker-mutator/instrumenter's dist, which its exports map leaves out.
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { types as babelTypes } from '@babel/core';
import type { Location, Mutant, Position } from '@stryker-mutator/api/core';

import { isOwn, toNodeMutator, type BabelTypes, type Operator } from './operator.ts';

const testedVersion = /^10\.1\./;
const coreBinPattern = /[\\/]@stryker-mutator[\\/]core[\\/]bin[\\/]stryker\.js$/;
/** Stryker's `// Stryker disable` directives match mutator names with letters only. */
const namePattern = /^[A-Za-z]+$/;
const nothing = () => undefined;
const silent = { debug: nothing, info: nothing, warn: nothing, isDebugEnabled: nothing };

export interface SourceFile {
  readonly name: string;
  readonly content: string;
}

export type InstrumentedMutant = Pick<Mutant, 'mutatorName' | 'replacement' | 'location'>;

/** A mutator of the instrumenter's list, Stryker's or this module's, as far as this module checks it. */
export interface ListedMutator {
  readonly name: string;
  readonly mutate: (...args: never) => unknown;
}

export interface Instrumenter {
  readonly dir: string;
  readonly version: string;
  /** The list that the instrumenter reads its mutators from each time it transforms a file. */
  readonly allMutators: ListedMutator[];
  /** The Babel types of the instrumenter's own @babel/core, to build the nodes it places. */
  readonly types: BabelTypes;
  instrument(files: readonly SourceFile[], mutators?: readonly ListedMutator[]): Promise<readonly InstrumentedMutant[]>;
}

export type Mode = 'add' | 'replace';

/**
 * Puts `operators` into the mutator list of Stryker's instrumenter, and throws unless each makes a mutant of its
 * sample: a bundled instrumenter does not read the list and would drop the operators without a word.
 */
export async function install(
  mode: Mode,
  operators: readonly Operator[],
  resolve: () => Promise<Instrumenter> = resolveFromCore,
  warn: (message: string) => void = console.warn,
): Promise<void> {
  const instrumenter = await resolve();
  const { allMutators } = instrumenter;
  checkNames(operators, allMutators);
  const mutators = operators.map((operator) => toNodeMutator(operator, instrumenter.types));

  if (mode === 'replace') {
    allMutators.splice(0, allMutators.length, ...mutators);
  } else {
    allMutators.push(...mutators.filter((mutator) => !allMutators.some(({ name }) => name === mutator.name)));
  }

  await selfCheck(instrumenter, operators);

  if (!testedVersion.test(instrumenter.version)) {
    warn(
      `lz-stryker-node-test-mutators was written for @stryker-mutator/instrumenter 10.1, not ${instrumenter.version}; ` +
        'its install check passed.',
    );
  }
}

function checkNames(operators: readonly Operator[], present: readonly ListedMutator[]): void {
  const names = operators.map(({ name }) => name);
  const invalid = names.filter((name) => !namePattern.test(name));

  if (invalid.length > 0) {
    throw new Error(
      `lz-stryker-node-test-mutators: a mutator name has letters only, as Stryker's directives match no other character: ` +
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
    throw new Error(`lz-stryker-node-test-mutators: another mutator already has the name ${taken.join(', ')}.`);
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
      `lz-stryker-node-test-mutators: the instrumenter in ${instrumenter.dir} made no mutants of ${missing.join(', ')} from ` +
        'their samples, so it does not read the mutator list this module added to. A bundled instrumenter does that.',
    );
  }
}

/**
 * The package.json of the @stryker-mutator/core that runs this process, from the script that started it when that is
 * core's bin, as when Stryker runs from a global install; otherwise, as when a program uses Stryker's API, the core
 * that this module resolves.
 */
export function corePackageJson(
  argv: readonly string[] = process.argv,
  realpath: (path: string) => string = realpathSync,
  resolveHere: (specifier: string) => string = createRequire(import.meta.url).resolve,
): string {
  const [, script] = argv;
  const bin = coreBin(script, realpath);

  return bin === undefined ? resolveHere('@stryker-mutator/core/package.json') : join(bin, '..', '..', 'package.json');
}

function coreBin(script: string | undefined, realpath: (path: string) => string): string | undefined {
  // `node --eval` and the REPL run no script file.
  if (script === undefined) {
    return undefined;
  }

  try {
    const bin = realpath(script);

    return coreBinPattern.test(bin) ? bin : undefined;
  } catch {
    // What `node --eval` passes on after its code is no script file either.
    return undefined;
  }
}

/**
 * `load` imports a file of the instrumenter or of its @babel/core. The instrumenter exports only its index, so these
 * modules have no importable types, and their members are checked before use.
 */
export async function resolveFromCore(
  corePackage: string = corePackageJson(),
  load: (path: string) => Promise<unknown> = importFile,
): Promise<Instrumenter> {
  const fromCore = createRequire(corePackage);
  const packageJson = fromCore.resolve('@stryker-mutator/instrumenter/package.json');
  const dir = dirname(packageJson);
  const mutateFile = join(dir, 'dist', 'src', 'mutators', 'mutate.js');
  const transformerFile = join(dir, 'dist', 'src', 'transformers', 'babel-transformer.js');
  const indexFile = join(dir, 'dist', 'src', 'index.js');
  const babelFile = createRequire(packageJson).resolve('@babel/core');
  const [mutate, transformer, index, babel] = await Promise.all(
    [mutateFile, transformerFile, indexFile, babelFile].map(load),
  );
  const transformBabel = member(transformer, 'transformBabel', isFunction, transformerFile);
  const instrumenterClass = member(index, 'Instrumenter', isFunction, indexFile);

  return {
    dir,
    version: member(fromCore(packageJson), 'version', isString, packageJson),
    allMutators: member(mutate, 'allMutators', isMutatorList, mutateFile),
    types: member(babel, 'types', isBabelTypes, babelFile),
    async instrument(files, mutators) {
      // The instrumenter takes a transform of its own in place of the one that reads `allMutators`.
      const transform =
        mutators &&
        ((ast: unknown, collector: unknown, context: unknown): unknown =>
          Reflect.apply(transformBabel, undefined, [ast, collector, context, mutators]));
      const instance: unknown = Reflect.construct(instrumenterClass, [silent, undefined, undefined, transform]);
      const instrument = member(instance, 'instrument', isFunction, `the Instrumenter of ${indexFile}`);
      const result: unknown = await Reflect.apply(instrument, instance, [
        files.map((file) => ({ ...file, mutate: true })),
        {
          plugins: null,
          // Stryker disable next-line ArrayDeclaration: equivalent, as no mutator is named "Stryker was here"
          excludedMutations: [],
          ignorers: [],
        },
      ]);

      return member(result, 'mutants', isMutantList, `the instrument() result of the Instrumenter of ${indexFile}`);
    },
  };
}

function importFile(path: string): Promise<unknown> {
  return import(pathToFileURL(path).href);
}

/** Every function is assignable to it, and `Reflect.apply` and `Reflect.construct` call it. */
type AnyFunction = (...args: never) => unknown;

function member<TKey extends string, T>(
  value: unknown,
  key: TKey,
  check: (member: unknown) => member is T,
  source: string,
): T {
  if (!hasMember(value, key, check)) {
    throw new Error(`lz-stryker-node-test-mutators: ${source} has no ${key} of the shape this module reads.`);
  }

  return value[key];
}

function hasMember<TKey extends string, T>(
  value: unknown,
  key: TKey,
  check: (member: unknown) => member is T,
): value is Record<TKey, T> {
  return typeof value === 'object' && value !== null && check(Reflect.get(value, key));
}

function isFunction(value: unknown): value is AnyFunction {
  return typeof value === 'function';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

function isMutatorList(value: unknown): value is ListedMutator[] {
  return Array.isArray(value) && value.every(isListedMutator);
}

function isListedMutator(value: unknown): value is ListedMutator {
  return hasMember(value, 'name', isString) && hasMember(value, 'mutate', isFunction);
}

/** Has every member of the @babel/core types this module is built against, each of the same kind. */
function isBabelTypes(value: unknown): value is BabelTypes {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.entries(babelTypes).every(([key, own]) => typeof Reflect.get(value, key) === typeof own)
  );
}

function isMutantList(value: unknown): value is InstrumentedMutant[] {
  return Array.isArray(value) && value.every(isMutant);
}

function isMutant(value: unknown): value is InstrumentedMutant {
  return (
    hasMember(value, 'mutatorName', isString) &&
    hasMember(value, 'replacement', isString) &&
    hasMember(value, 'location', isLocation)
  );
}

function isLocation(value: unknown): value is Location {
  return hasMember(value, 'start', isPosition) && hasMember(value, 'end', isPosition);
}

function isPosition(value: unknown): value is Position {
  return hasMember(value, 'line', isNumber) && hasMember(value, 'column', isNumber);
}
