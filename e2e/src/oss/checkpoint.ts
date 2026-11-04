import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { extname, relative, sep } from 'node:path';

import type { MutantResult, schema, StrykerOptions } from '@stryker-mutator/api/core';
import { commonTokens, declareClassPlugin, PluginKind, tokens } from '@stryker-mutator/api/plugin';
import type { DryRunCompletedEvent, Reporter } from '@stryker-mutator/api/report';
import type { TestResult } from '@stryker-mutator/api/test-runner';

import { lzIsRecord } from '../report.ts';

/** The name the driver adds to Stryker's `--reporters`. */
export const lzCheckpointReporterName = 'lz-checkpoint';

export interface LzCheckpointDeps {
  /** The folder Stryker runs in, which report file names are relative to. */
  readonly cwd: string;
  readonly now: () => number;
  readonly readSource: (file: string) => string;
}

const defaultDeps: LzCheckpointDeps = {
  cwd: process.cwd(),
  now: () => Date.now(),
  readSource: (file) => readFileSync(file, 'utf8'),
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
  readonly #mutants: MutantResult[] = [];
  #tests: readonly TestResult[] = [];
  #lastWrite: number | undefined;

  constructor(
    { incrementalFile }: Pick<StrykerOptions, 'incrementalFile'>,
    deps: LzCheckpointDeps = defaultDeps,
    intervalMs = 5_000,
  ) {
    this.#file = incrementalFile;
    this.#deps = deps;
    this.#intervalMs = intervalMs;
  }

  onDryRunCompleted({ result }: DryRunCompletedEvent): void {
    this.#tests = result.tests;
  }

  onMutantTested(result: Readonly<MutantResult>): void {
    this.#mutants.push(result);
    const now = this.#deps.now();

    this.#lastWrite ??= now;

    if (now - this.#lastWrite >= this.#intervalMs) {
      this.#lastWrite = now;
      const { cwd, readSource } = this.#deps;
      const temporary = `${this.#file}.tmp`;

      writeFileSync(temporary, JSON.stringify(lzCheckpointReport(this.#mutants, this.#tests, cwd, readSource)));
      renameSync(temporary, this.#file);
    }
  }
}

export const strykerPlugins = [declareClassPlugin(PluginKind.Reporter, lzCheckpointReporterName, LzCheckpointReporter)];

/** A mutation report of `mutants` and the dry run's `tests`, in the form Stryker reads with `--incremental`. */
export function lzCheckpointReport(
  mutants: readonly MutantResult[],
  tests: readonly TestResult[],
  cwd: string,
  readSource: (file: string) => string,
): schema.MutationTestResult {
  const files: Record<string, schema.FileResult> = {};
  const testFiles: Record<string, schema.TestFile> = {};

  mutants.forEach(({ fileName, ...mutant }) => {
    const file = (files[reportName(cwd, fileName)] ??= {
      language: ['.ts', '.tsx', '.mts', '.cts'].includes(extname(fileName)) ? 'typescript' : 'javascript',
      source: readSource(fileName),
      mutants: [],
    });

    file.mutants.push(mutant);
  });
  tests.forEach(({ id, name, fileName, startPosition }) => {
    const file = (testFiles[fileName === undefined ? '' : reportName(cwd, fileName)] ??=
      fileName === undefined ? { tests: [] } : { source: readSource(fileName), tests: [] });

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

/** The arguments that have Stryker resume from `file`, keep it up to date through this module, and overwrite it at the end. */
export function lzCheckpointArgs(file: string): string[] {
  return ['--incremental', '--incrementalFile', file, '--appendPlugins', import.meta.filename];
}

/**
 * Keeps the checkpoint at `file` only when it was written under `key`, which names what decides the mutants' results
 * (such as the runner's tarballs), and returns how many mutants the run reuses.
 */
export function lzStartCheckpoint(file: string, key: string): number {
  const keyFile = `${file}.key`;

  if (!existsSync(keyFile) || readFileSync(keyFile, 'utf8') !== key) {
    rmSync(file, { force: true });
    writeFileSync(keyFile, key);
  }

  return lzCheckpointMutants(file);
}

/** After a run that wrote its report, which the side's `mutation.json` now holds. */
export function lzEndCheckpoint(file: string): void {
  rmSync(file, { force: true });
  rmSync(`${file}.key`, { force: true });
}

/** How many mutants the checkpoint at `file` holds; 0 when there is none. */
export function lzCheckpointMutants(file: string): number {
  let text: string;

  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return 0;
    }

    throw error;
  }

  const report: unknown = JSON.parse(text);
  const files = lzIsRecord(report) ? report['files'] : undefined;

  if (!lzIsRecord(files)) {
    throw new Error(`${file} holds no mutation report.`);
  }

  return Object.values(files).reduce<number>((count, entry) => {
    const mutants = lzIsRecord(entry) ? entry['mutants'] : undefined;

    if (!Array.isArray(mutants)) {
      throw new Error(`${file} holds no mutation report.`);
    }

    return count + mutants.length;
  }, 0);
}

/** Stryker's report file name: relative to the folder it runs in, with forward slashes. */
function reportName(cwd: string, file: string): string {
  return relative(cwd, file).split(sep).join('/');
}
