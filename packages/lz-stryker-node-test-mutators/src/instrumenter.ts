// The one module that reaches into Stryker's internals: no other module of this package names a file of
// @stryker-mutator/instrumenter's dist, which its exports map leaves out.
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Location, Mutant, Position } from '@stryker-mutator/api/core';

import { hasMember, isFunction, isNumber, isObject, isString, member } from './guards.ts';
import { operatorBuilders, type BabelTypes } from './operator.ts';

const coreBinPattern = /[\\/]@stryker-mutator[\\/]core[\\/]bin[\\/]stryker\.js$/;
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
  readonly allMutators: readonly ListedMutator[];
  /** Replaces the contents of `allMutators`, in place, so the instrumenter reads the new list. */
  setMutators(mutators: readonly ListedMutator[]): void;
  /** The Babel types of the instrumenter's own @babel/core, to build the nodes it places. */
  readonly types: BabelTypes;
  instrument(files: readonly SourceFile[], mutators?: readonly ListedMutator[]): Promise<readonly InstrumentedMutant[]>;
}

export function resolveEachCore(): Promise<readonly Instrumenter[]> {
  return Promise.all(corePackageJsons().map((corePackage) => resolveFromCore(corePackage)));
}

/**
 * The package.json of each copy of @stryker-mutator/core that may run this process: from the script that started it
 * when that is core's bin, as when Stryker runs from a global install; otherwise, as when a program uses Stryker's API,
 * the core that this module resolves, in the drive-letter case of that program's script and in this module's own.
 */
export function corePackageJsons(
  argv: readonly string[] = process.argv,
  realpath: (path: string) => string = realpathSync,
  resolveHere: (specifier: string) => string = createRequire(import.meta.url).resolve,
): readonly [string, ...string[]] {
  const [, script] = argv;
  const real = realScript(script, realpath);

  if (real !== undefined && coreBinPattern.test(real)) {
    return [join(real, '..', '..', 'package.json')];
  }

  const here = resolveHere('@stryker-mutator/core/package.json');
  const scriptCase = real === undefined ? here : withDriveLetterOf(real, here);

  return scriptCase === here ? [here] : [scriptCase, here];
}

function realScript(script: string | undefined, realpath: (path: string) => string): string | undefined {
  // `node --eval` and the REPL run no script file.
  if (script === undefined) {
    return undefined;
  }

  try {
    return realpath(script);
  } catch {
    // What `node --eval` passes on after its code is no script file either.
    return undefined;
  }
}

/**
 * Stryker's modules load with the drive-letter case of the script that started the process when that script imports
 * Stryker, and with the case of the working directory, as this module does, when a runner such as mocha loads the
 * module that imports Stryker. ESM caches modules by URL, which keeps that case, so `d:` and `D:` load two
 * instrumenters, and a self-check of one would pass while Stryker runs the other.
 */
function withDriveLetterOf(script: string, path: string): string {
  const drive = /^[A-Za-z]:/.exec(script)?.[0];

  return drive !== undefined && path.slice(0, 2).toLowerCase() === drive.toLowerCase() ? drive + path.slice(2) : path;
}

/**
 * `load` imports a file of the instrumenter or of its @babel/core. The instrumenter exports only its index, so these
 * modules have no importable types, and their members are checked before use.
 */
export async function resolveFromCore(
  corePackage: string = corePackageJsons()[0],
  load: (path: string) => Promise<unknown> = importFile,
): Promise<Instrumenter> {
  const fromCore = createRequire(corePackage);
  const packageJson = fromCore.resolve('@stryker-mutator/instrumenter/package.json');
  const dir = dirname(packageJson);
  const mutateFile = join(dir, 'dist', 'src', 'mutators', 'mutate.js');
  const transformerFile = join(dir, 'dist', 'src', 'transformers', 'babel-transformer.js');
  const indexFile = fromCore.resolve('@stryker-mutator/instrumenter');
  const babelFile = createRequire(packageJson).resolve('@babel/core');
  const [mutate, transformer, index, babel] = await Promise.all(
    [mutateFile, transformerFile, indexFile, babelFile].map(load),
  );
  const transformBabel = member(transformer, 'transformBabel', isFunction, transformerFile);
  const instrumenterClass = member(index, 'Instrumenter', isFunction, indexFile);
  const allMutators = member(mutate, 'allMutators', isMutatorList, mutateFile);

  return {
    dir,
    version: member(fromCore(packageJson), 'version', isString, packageJson),
    allMutators,
    setMutators(mutators) {
      allMutators.splice(0, allMutators.length, ...mutators);
    },
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

function isMutatorList(value: unknown): value is ListedMutator[] {
  return Array.isArray(value) && value.every(isListedMutator);
}

function isListedMutator(value: unknown): value is ListedMutator {
  return hasMember(value, 'name', isString) && hasMember(value, 'mutate', isFunction);
}

/**
 * Has a function for each member of the Babel types that the operators may call. The other members can differ, as when
 * the consumer's @babel/core is a newer patch than the instrumenter's.
 */
function isBabelTypes(value: unknown): value is BabelTypes {
  return isObject(value) && operatorBuilders.every((key) => isFunction(Reflect.get(value, key)));
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
