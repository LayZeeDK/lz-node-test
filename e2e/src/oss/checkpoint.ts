import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { extname, relative, sep } from 'node:path';

import type { MutantResult, schema, StrykerOptions } from '@stryker-mutator/api/core';
import { commonTokens, declareClassPlugin, PluginKind, tokens } from '@stryker-mutator/api/plugin';
import type { DryRunCompletedEvent, Reporter } from '@stryker-mutator/api/report';
import type { TestResult } from '@stryker-mutator/api/test-runner';

import { lzIsRecord, lzParseReport } from '../report.ts';
import { lzDecidingFields, type LzDecidingFields } from './result.ts';

/** The name the driver adds to Stryker's `--reporters`. */
export const lzCheckpointReporterName = 'lz-checkpoint';

export interface LzCheckpointDeps {
  /** The folder Stryker runs in, which report file names are relative to. */
  readonly cwd: string;
  readonly now: () => number;
  /** Undefined for a file that cannot be read, which Stryker's own report tolerates too. */
  readonly readSource: (file: string) => string | undefined;
}

const defaultDeps: LzCheckpointDeps = {
  cwd: process.cwd(),
  now: () => Date.now(),
  readSource: (file) => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  },
};

/**
 * Keeps the mutants tested so far in Stryker's `incrementalFile`, so that a run ended before its report reuses them
 * when the next run reads that file with `--incremental`. Stryker overwrites the file with its full report at the end.
 */
export class LzCheckpointReporter implements Reporter {
  static inject = tokens(commonTokens.options);
  readonly #file: string;
  readonly #deps: LzCheckpointDeps;
  readonly #intervalMs: number;
  readonly #mutants: Readonly<MutantResult>[] = [];
  #tests: readonly TestResult[] = [];
  #lastWrite: number;

  constructor(
    { incrementalFile }: Pick<StrykerOptions, 'incrementalFile'>,
    deps: LzCheckpointDeps = defaultDeps,
    // Stryker disable next-line LzJsNumericLiteral: a tuning value, not a contract a test should pin
    intervalMs = 5_000,
  ) {
    this.#file = incrementalFile;
    this.#deps = deps;
    this.#intervalMs = intervalMs;
    this.#lastWrite = deps.now();
  }

  onDryRunCompleted({ result }: DryRunCompletedEvent): void {
    this.#tests = result.tests;
  }

  onMutantTested(result: Readonly<MutantResult>): void {
    this.#mutants.push(result);
    const now = this.#deps.now();

    if (now - this.#lastWrite >= this.#intervalMs) {
      this.#lastWrite = now;
      this.#write();
    }
  }

  /** Through a file beside it and a rename, so a run ended mid-write keeps the previous checkpoint. */
  #write(): void {
    const { cwd, readSource } = this.#deps;
    const temporary = `${this.#file}.tmp`;

    writeFileSync(temporary, JSON.stringify(lzCheckpointReport(this.#mutants, this.#tests, cwd, readSource)));
    renameSync(temporary, this.#file);
  }
}

export const strykerPlugins = [declareClassPlugin(PluginKind.Reporter, lzCheckpointReporterName, LzCheckpointReporter)];

/** A mutation report of `mutants` and the dry run's `tests`, in the form Stryker reads with `--incremental`. */
export function lzCheckpointReport(
  mutants: readonly Readonly<MutantResult>[],
  tests: readonly TestResult[],
  cwd: string,
  readSource: (file: string) => string | undefined,
): schema.MutationTestResult {
  const files: Record<string, schema.FileResult> = {};
  const testFiles: Record<string, schema.TestFile> = {};

  mutants.forEach(({ fileName, ...mutant }) => {
    const file = (files[reportName(cwd, fileName)] ??= {
      language: languageOf(fileName),
      source: readSource(fileName) ?? '',
      mutants: [],
    });

    file.mutants.push(mutant);
  });
  tests.forEach(({ id, name, fileName, startPosition }) => {
    const file = (testFiles[fileName === undefined ? '' : reportName(cwd, fileName)] ??= testFile(
      fileName,
      readSource,
    ));

    file.tests.push({
      id,
      name,
      ...(startPosition === undefined
        ? {}
        : { location: { start: { line: startPosition.line + 1, column: startPosition.column + 1 } } }),
    });
  });

  return { schemaVersion: '1.0', thresholds: { high: 80, low: 60 }, files, testFiles };
}

/** What decides a side's mutant results beyond the code Stryker diffs itself, so a run that differs starts afresh. */
export interface LzCheckpointKeyInputs extends LzDecidingFields {
  readonly mutate: readonly string[];
  readonly strykerConfig: string;
}

/** Of the named fields only, so a header passed whole adds none of its others, such as its start time. */
export function lzCheckpointKey(inputs: LzCheckpointKeyInputs): string {
  return JSON.stringify([...lzDecidingFields.map((field) => inputs[field]), inputs.mutate, inputs.strykerConfig]);
}

export function lzInstalledVersions(hiddenLockfile: string): string[] {
  const lockfile: unknown = JSON.parse(hiddenLockfile);
  const packages = lzIsRecord(lockfile) ? lockfile['packages'] : undefined;

  if (!lzIsRecord(packages)) {
    throw new Error('npm\'s node_modules/.package-lock.json lists no "packages".');
  }

  return Object.entries(packages)
    .map(
      ([path, entry]) => `${path}@${lzIsRecord(entry) && typeof entry['version'] === 'string' ? entry['version'] : ''}`,
    )
    .sort();
}

/** The arguments that have Stryker resume from `file`, keep it up to date through this module, and overwrite it at the end. */
export function lzCheckpointArgs(file: string): string[] {
  return ['--incremental', '--incrementalFile', file, '--appendPlugins', import.meta.filename];
}

/**
 * Keeps the checkpoint at `file` only when it was written under `key`, and returns how many mutants it holds. Stryker
 * still retests those whose code or tests changed.
 */
export function lzStartCheckpoint(file: string, key: string): number {
  const keyFile = `${file}.key`;

  if (!existsSync(keyFile) || readFileSync(keyFile, 'utf8') !== key) {
    if (existsSync(file)) {
      process.stdout.write(`Discarded ${file}: it was written by a run with other options, tarballs or project.\n`);
    }

    rmSync(file, { force: true });
    writeFileSync(keyFile, key);
  }

  return existsSync(file) ? lzCheckpointMutants(file) : 0;
}

/** After a run that wrote its report, which the side's `mutation.json` now holds, or one that could not resume. */
export function lzEndCheckpoint(file: string): void {
  [file, `${file}.key`, `${file}.tmp`].forEach((path) => {
    rmSync(path, { force: true });
  });
}

/** How many mutants the checkpoint at `file` holds. */
export function lzCheckpointMutants(file: string): number {
  return [...lzParseReport(readFileSync(file, 'utf8')).values()].reduce((count, mutants) => count + mutants.length, 0);
}

function testFile(fileName: string | undefined, readSource: (file: string) => string | undefined): schema.TestFile {
  const source = fileName === undefined ? undefined : readSource(fileName);

  return source === undefined ? { tests: [] } : { source, tests: [] };
}

function languageOf(fileName: string): string {
  return ['.ts', '.tsx', '.mts', '.cts'].includes(extname(fileName)) ? 'typescript' : 'javascript';
}

/** Stryker's report file name: relative to the folder it runs in, with forward slashes. */
function reportName(cwd: string, file: string): string {
  return relative(cwd, file).split(sep).join('/');
}
