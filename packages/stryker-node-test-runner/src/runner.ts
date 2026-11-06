import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  INSTRUMENTER_CONSTANTS,
  type CoverageAnalysis,
  type MutantCoverage,
  type StrykerOptions,
} from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import { commonTokens, declareClassPlugin, PluginKind, tokens } from '@stryker-mutator/api/plugin';
import {
  determineHitLimitReached,
  DryRunStatus,
  TestStatus,
  toMutantRunResult,
  type DryRunOptions,
  type DryRunResult,
  type MutantActivation,
  type MutantRunOptions,
  type MutantRunResult,
  type TestResult,
  type TestRunner,
  type TestRunnerCapabilities,
} from '@stryker-mutator/api/test-runner';

import { lzMergeAsStatic, lzMergeCoverage, lzOverlapCoverage } from './coverage.ts';
import { lzDirPrefix, removeDir, removeLeftDirs } from './dirs.ts';
import { isNumber, isObject, isStrings, optional } from './guards.ts';
import { lzDryRunDir, lzDryRunStore, lzOwnDryRun, type LzDryRunStore } from './dry-run-store.ts';
import { memoryLimits, type MemoryLimits } from './memory-limits.ts';
import { lzConsumerNodeOptions, withoutReporters } from './node-options.ts';
import { groupOptions, lzStderrTailBytes, processEnd } from './process-end.ts';
import {
  envNames,
  lzIsRecordName,
  lzNamesFile,
  lzOutsideMs,
  lzParseRecord,
  testId,
  within,
  type ProcessRecord,
  type RecordedTest,
} from './record.ts';
import schema from './schema/node-test-runner-options.json' with { type: 'json' };
import { lzStartUpOf, lzStartUps, type LzStartUps } from './start-up.ts';

/** Options under `lzNodeTest` in the Stryker configuration, which `schema/node-test-runner-options.json` describes. */
export interface LzNodeTestOptions {
  readonly testFiles?: readonly string[];
  readonly nodeArgs?: readonly string[];
  readonly maxMemoryMB?: number;
}

const defaults = schema.properties.lzNodeTest.properties;

/** The oldest Node.js the runner supports, as `engines` in package.json says, as major and minor version. */
export const lzMinNodeVersion: readonly [major: number, minor: number] = [22, 18];

function supportsNode(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  const [minMajor, minMinor] = lzMinNodeVersion;

  return major > minMajor || (major === minMajor && minor >= minMinor);
}

export type LzRunOptions =
  | {
      readonly dryRun: true;
      readonly disableBail: boolean;
      readonly coverageAnalysis: CoverageAnalysis;
      /** The files Stryker instrumented, which it reprints without a source map: DryRunOptions.files. */
      readonly instrumented?: ReadonlySet<string>;
      readonly activeMutant?: undefined;
      readonly mutantActivation?: undefined;
      readonly hitLimit?: undefined;
      readonly testFilter?: undefined;
    }
  | {
      readonly dryRun: false;
      readonly disableBail: boolean;
      readonly coverageAnalysis?: undefined;
      readonly instrumented?: undefined;
      readonly activeMutant?: string;
      readonly mutantActivation?: MutantActivation;
      // undefined as Stryker's MutantRunOptions give them: no hit limit, every test.
      readonly hitLimit?: number | undefined;
      readonly testFilter?: readonly string[] | undefined;
    };

/** A mutant run's deadline, which ends a file's process once `signal` aborts, as a timeout for `reason`. */
interface LzDeadline {
  readonly signal: AbortSignal;
  readonly reason: string;
}

interface LzFileRun {
  readonly records: readonly ProcessRecord[];
  readonly exitCode: number | null;
  readonly stderr: string;
  /** node's arguments after the runner's reporter: lzNodeTest.nodeArgs and the test file. */
  readonly fileArgs: readonly string[];
  /** The consumer's NODE_OPTIONS that the test file ran with, as `lzConsumerNodeOptions` gives them. */
  readonly nodeOptions: readonly string[];
  readonly unreadable?: string;
  /** The deadline's reason, set when the deadline of a mutant run ended the file's process while it ran. */
  readonly killedByDeadline?: string;
}

// .ts from the source, .js from the build.
const ext = extname(import.meta.filename);
const hookUrl = pathToFileURL(resolve(import.meta.dirname, `hook${ext}`)).href;
const reporterUrl = pathToFileURL(resolve(import.meta.dirname, `reporter${ext}`)).href;

const dryRunOwner = lzOwnDryRun();

/**
 * A test's name leaves out the test file, which its id starts with, as Stryker's runners name tests after their suites
 * only.
 *
 * Each test's time includes the time the file's run, `fileMs`, spent outside its outermost tests, whose time includes
 * their subtests': running any test of the file runs the file's whole process. Stryker's mutant timeout scales with
 * the summed time of the tests it runs, so it then scales with the processes it starts, which Stryker's other workers
 * slow down as well. It counts a file's start-up once per covering test; `mutantRun` ends a run once each file's
 * start-up has been counted once, and Stryker's timer stays as the backstop.
 *
 * A test keeps its start position only when `positioned`: Stryker diffs each test's span in the test file's source, so a
 * position in a reprinted, instrumented copy would cut out the wrong span.
 */
export function lzToTestResults(
  testFile: string,
  recorded: RecordedTest[],
  fileMs: number,
  positioned = true,
): TestResult[] {
  const prefix = testId(testFile, '');
  const outside = lzOutsideMs(recorded, fileMs);

  return recorded.map((test) => {
    const base = {
      id: test.id,
      name: test.id.slice(prefix.length),
      fileName: testFile,
      timeSpentMs: Math.round(test.timeSpentMs + outside),
      ...(positioned && test.startPosition && { startPosition: test.startPosition }),
    };

    if (test.status === 'failed') {
      return { ...base, status: TestStatus.Failed, failureMessage: test.failureMessage ?? 'Test failed' };
    }

    return { ...base, status: test.status === 'passed' ? TestStatus.Success : TestStatus.Skipped };
  });
}

function nodeCommand(args: readonly string[]): string {
  return ['node', ...args.map((arg) => `"${arg}"`)].join(' ');
}

/**
 * Reports a test file that failed outside its tests as Stryker's tap runner does: command, diagnostics, and the tail of
 * stderr that `processEnd` keeps.
 */
export function lzFileError(testFile: string, { records, exitCode, stderr, fileArgs, nodeOptions }: LzFileRun): string {
  const diagnostics = records.flatMap((record) => record.diagnostics ?? []);
  const heldOpen = records.flatMap((record) => record.heldOpen ?? []);
  const output = stderr.trim();
  const withNodeOptions = nodeOptions.length > 0 ? ` with NODE_OPTIONS set to \`${nodeOptions.join(' ')}\`` : '';

  return [
    `Error running file "${testFile}": node exited with code ${String(exitCode)} outside any test.`,
    `To reproduce it without the mutant, run \`${nodeCommand(['--test', ...fileArgs])}\` in ` +
      `${process.cwd()}${withNodeOptions}, without the runner's reporter and hook.`,
    ...(heldOpen.length > 0
      ? [
          `It stayed alive after its tests, held open by ${heldOpen.join(', ')}, until the runner ended it; node:test ` +
            'reports an error raised after a test ended only when its process ends by itself.',
        ]
      : []),
    ...(diagnostics.length > 0 ? ['Diagnostics:', ...diagnostics] : []),
    ...(output ? [`Stderr, at most its last ${lzStderrTailBytes / 1024} KiB:`, output] : []),
  ].join('\n');
}

function notOptions(field?: string): never {
  const message = 'not valid lzNodeTest options';

  throw new Error(field === undefined ? message : `${message}: ${field}`);
}

/** Stryker checks the options against the schema first; this proves the fields the runner reads. */
function parseOptions(value: unknown): LzNodeTestOptions {
  if (value === undefined) {
    return {};
  }

  if (!isObject(value)) {
    notOptions();
  }

  const { testFiles, nodeArgs, maxMemoryMB } = value;

  return {
    ...optional('testFiles', testFiles, isStrings, notOptions),
    ...optional('nodeArgs', nodeArgs, isStrings, notOptions),
    ...optional('maxMemoryMB', maxMemoryMB, isNumber, notOptions),
  };
}

type FileOutcome =
  | { readonly end: DryRunResult }
  | {
      readonly results: readonly TestResult[];
      readonly coverages: readonly (MutantCoverage | undefined)[];
      readonly failed: boolean;
    };

export async function lzRunInPool<T, TResult>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<TResult>,
  stops: (result: TResult) => boolean,
): Promise<TResult[]> {
  const results: TResult[] = [];
  // The lanes share one iterator, so each item goes to one lane; an array iterator has no `return` for a lane to close.
  const queue = items.entries();
  let end = items.length;
  let failed = false;
  const lane = async () => {
    for (const [index, item] of queue) {
      if (failed || index >= end) {
        return;
      }

      try {
        const result = await work(item);
        results[index] = result;

        if (stops(result)) {
          end = Math.min(end, index + 1);
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  const lanes = await Promise.allSettled(Array.from({ length: limit }, lane));
  const rejected = lanes.find((settled) => settled.status === 'rejected');

  if (rejected) {
    throw rejected.reason;
  }

  return results.slice(0, end);
}

function fileOutcome(file: string, fileRun: LzFileRun, fileMs: number, run: LzRunOptions): FileOutcome {
  const { records, exitCode, unreadable } = fileRun;

  if (fileRun.killedByDeadline !== undefined) {
    return { end: { status: DryRunStatus.Timeout, reason: fileRun.killedByDeadline } };
  }

  const memoryLimitReached = records.find((record) => record.memoryLimitReached)?.memoryLimitReached;

  if (memoryLimitReached) {
    const { rssMB, limitMB } = memoryLimitReached;
    const errorMessage =
      `A process of "${file}" held ${rssMB} MB in the dry run, more than lzNodeTest.maxMemoryMB (${limitMB} MB), so ` +
      "its mutant runs would time out. Raise lzNodeTest.maxMemoryMB, or leave it out to derive each file's limit from " +
      'the dry run.';

    return dryRunErrorElseTimeout(run, errorMessage, `Memory limit reached (${rssMB}/${limitMB} MB)`);
  }

  if (unreadable !== undefined) {
    return errorEnd(`Unreadable test results for "${file}": ${unreadable}`);
  }

  const main = records.find((record) => record.main);
  const stalledMs = main?.stalledMs;

  if (stalledMs !== undefined) {
    return {
      end: {
        status: DryRunStatus.Timeout,
        reason: `A test was still pending ${stalledMs} ms after its file's event loop emptied (Stryker's timeoutMS)`,
      },
    };
  }

  for (const record of records) {
    const timeout = determineHitLimitReached(record.hitCount, run.hitLimit);

    if (timeout) {
      return { end: timeout };
    }
  }

  const results = lzToTestResults(
    file,
    records.flatMap((record) => record.tests),
    fileMs,
    !run.instrumented?.has(file),
  );
  const failed = results.some((result) => result.status === TestStatus.Failed);

  // Like Stryker's own runners, a failure that no test explains is an error, not a killed mutant.
  if (exitCode !== 0 && !failed) {
    return errorEnd(lzFileError(file, fileRun));
  }

  if (!main) {
    return errorEnd(
      `Missing test results for "${file}": its process ended without writing them. Either the Stryker hook ` +
        'did not run in it, it left without running exit listeners (process.reallyExit, process.abort), or it ran ' +
        'under the permission model without write access to the temporary directory.',
    );
  }

  // The hook ended a file that something its tests opened kept alive, which `node --test` would wait for forever: in
  // the dry run an error to fix, and in a mutant run a timeout, which the runner's deadline or Stryker's own timer
  // reports first unless the file's tests take most of the budget.
  if (!failed && main.heldOpen) {
    const heldBy = main.heldOpen.join(', ');
    const errorMessage =
      `Test file "${file}" stayed alive after its tests and root after hooks ended, held open by ${heldBy}, so ` +
      'node --test would not end either. Close what its tests open in an after hook, or pass --test-force-exit in ' +
      'lzNodeTest.nodeArgs, as for node --test (NODE_OPTIONS does not allow it); node:test then loses errors ' +
      'raised after the tests and root after hooks end.';

    return dryRunErrorElseTimeout(run, errorMessage, `Test file "${file}" stayed alive, held open by ${heldBy}`);
  }

  // Stryker treats a test runner that exits during a run as crashed, whatever its exit code, and so do its runners
  // that run the tests in their own process; the tests that node:test did not report are unknown.
  if (!failed && main.unfinished) {
    return errorEnd(
      `Unfinished test results for "${file}": its process exited before node:test reported every test, as when ` +
        'a test calls process.exit().',
    );
  }

  return { results, coverages: records.map((record) => lzOverlapCoverage(record, main.testSpans)), failed };
}

function hasHits({ static: hits, perTest }: MutantCoverage): boolean {
  return [hits, ...Object.values(perTest)].some((ofTest) => Object.keys(ofTest).length > 0);
}

function errorEnd(errorMessage: string): FileOutcome {
  return { end: { status: DryRunStatus.Error, errorMessage } };
}

function dryRunErrorElseTimeout(run: LzRunOptions, errorMessage: string, reason: string): FileOutcome {
  return run.dryRun ? errorEnd(errorMessage) : { end: { status: DryRunStatus.Timeout, reason } };
}

/** The test files that the dry run stored under `key`, or undefined when it stored none. */
export function lzStoredFiles(key: string, content: string | undefined): string[] | undefined {
  if (content === undefined) {
    return undefined;
  }

  const message = `The dry-run store's files entry ${key} is no JSON array of test files: ${content}`;
  let files: unknown;

  try {
    files = JSON.parse(content);
  } catch (error) {
    throw new Error(message, { cause: error });
  }

  if (!isStrings(files)) {
    throw new Error(message);
  }

  return files;
}

export function lzFilesFor(testFiles: string[], testFilter: readonly string[] | undefined): string[] {
  if (!testFilter) {
    return testFiles;
  }

  return testFiles.filter((file) => testFilter.some((id) => within(id, file)));
}

/**
 * How many test runner processes Stryker runs the mutants in, as `ConcurrencyTokenProvider` in `@stryker-mutator/core`
 * computes them: `concurrency` as a number or a percentage of the cores, by default one less than the cores above 4.
 * Beside checkers, Stryker splits it between checkers and test runners, at least one each, and hands the checkers'
 * share to test runners once checking is done (`freeCheckers`), so a concurrency of 1 ends with 2 test runners.
 */
export function lzTestRunnerConcurrency(
  concurrency: StrykerOptions['concurrency'],
  checkers: boolean,
  cores: number,
): number {
  const percentage = /^(100|[1-9]?[0-9])%$/.exec(String(concurrency))?.[1];
  let total = cores > 4 ? cores - 1 : cores;

  if (percentage !== undefined) {
    total = Math.max(1, Math.round((cores * Number(percentage)) / 100));
  } else if (typeof concurrency === 'number') {
    total = concurrency;
  }

  return checkers ? Math.max(Math.ceil(total / 2), 1) + Math.max(Math.floor(total / 2), 1) : total;
}

/** What a test file's environment is made from: the runner's own environment, the file, and the run. */
export interface LzRunEnvInput {
  /** The runner's environment; its NODE_OPTIONS gives way to the hook and `nodeOptions`. */
  readonly base: NodeJS.ProcessEnv;
  readonly file: string;
  readonly outDir: string;
  readonly tmpDir: string;
  readonly run: LzRunOptions;
  readonly cacheDir: string | undefined;
  /** The consumer's NODE_OPTIONS, which follow the runner's hook, as `lzConsumerNodeOptions` gives them. */
  readonly nodeOptions: readonly string[];
  readonly memoryLimitMB?: number | undefined;
  readonly heldOpenMs?: number | undefined;
  /** Stryker's timeoutMS: how long a mutant run waits for a test result once a file's event loop is empty. */
  readonly stallMs?: number | undefined;
}

export function lzRunEnv({
  base,
  file,
  outDir,
  tmpDir,
  run,
  cacheDir,
  nodeOptions,
  memoryLimitMB,
  heldOpenMs,
  stallMs,
}: LzRunEnvInput): NodeJS.ProcessEnv & { NODE_OPTIONS: string } {
  const runState = new Set([
    // Set when Stryker itself runs under `node --test`; node:test in the test file would then ignore `.only` and
    // write its report to stdout for an outer runner instead of using its reporters.
    'NODE_TEST_CONTEXT',
    INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE,
    ...Object.values(envNames),
  ]);
  const env: NodeJS.ProcessEnv & { NODE_OPTIONS: string } = {
    ...Object.fromEntries(Object.entries(base).filter(([key]) => !runState.has(key))),
    // The hook comes first, so a copy of this runner under test takes precedence over the runner running it.
    NODE_OPTIONS: [`--import ${JSON.stringify(hookUrl)}`, ...nodeOptions].join(' '),
    [envNames.out]: outDir,
    [envNames.file]: file,
    [envNames.dryRun]: String(run.dryRun),
    // The hook ends the file's process group once its parent is no longer this process.
    [envNames.runner]: String(process.pid),
    // os.tmpdir() reads TMPDIR first on POSIX and TEMP first on Windows, then TMP.
    TMPDIR: tmpDir,
    TEMP: tmpDir,
    TMP: tmpDir,
  };

  if (env['NODE_COMPILE_CACHE'] === undefined && cacheDir !== undefined) {
    env['NODE_COMPILE_CACHE'] = cacheDir;
  }

  // At runtime activation the hook activates the mutant once the tests start, so module-level code runs unmutated.
  // Stryker names whole test files in the filter only for a mutant that runs every test, as a static mutant under
  // --testFiles does, yet asks for runtime activation; such a mutant must be active from the start.
  if (run.activeMutant !== undefined) {
    const runtime = run.mutantActivation === 'runtime' && !lzNamesFile(run.testFilter, file);
    env[runtime ? envNames.activeMutant : INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE] = run.activeMutant;
  }

  if (run.hitLimit !== undefined) {
    env[envNames.hitLimit] = String(run.hitLimit);
  }

  if (memoryLimitMB !== undefined) {
    env[envNames.memoryLimit] = String(memoryLimitMB);
  }

  if (heldOpenMs !== undefined) {
    env[envNames.heldOpen] = String(heldOpenMs);
  }

  // Linux refuses a variable longer than 128 KiB. The whole filter of a widely covered mutant can pass that, and so,
  // less often, can the ids of one file's many covering tests.
  if (run.testFilter) {
    env[envNames.filter] = JSON.stringify(run.testFilter.filter((id) => within(id, file)));
  }

  // The dry run must run every test to collect each one's coverage.
  if (!run.dryRun && !run.disableBail) {
    env[envNames.bail] = 'true';
  }

  if (!run.dryRun && stallMs !== undefined) {
    env[envNames.stall] = String(stallMs);
  }

  return env;
}

const shortenedHeldOpen = new WeakMap<LzNodeTestTestRunner, number>();

/** Shortens the time a test file of `runner` may stay alive after its tests to `ms`, for the runner's own tests. */
export function lzShortenHeldOpen(runner: LzNodeTestTestRunner, ms: number): void {
  shortenedHeldOpen.set(runner, ms);
}

/** The Stryker options the runner reads, of all that Stryker passes it. */
type RunnerStrykerOptions = Pick<
  StrykerOptions,
  'allowEmpty' | 'checkers' | 'concurrency' | 'testFiles' | 'timeoutFactor' | 'timeoutMS'
> & {
  readonly lzNodeTest?: unknown;
};

export class LzNodeTestTestRunner implements TestRunner {
  static inject = tokens(commonTokens.options, commonTokens.logger);

  #testFiles: string[] = [];
  /**
   * The test files the dry run ran, which every runner's mutant runs run. Stryker gives the dry run sandbox copies of
   * its --testFiles, which an absolute pattern of `#patterns` finds outside the sandbox.
   */
  #dryRunFiles?: string[] | undefined;
  /** Under which the dry-run store keeps the files the dry run ran, apart from runners of other projects or patterns. */
  readonly #dryRunFilesKey: string;
  /**
   * Every process compiles the hook and its imports; Node's compile cache makes that a one-time cost per runner.
   * The directory is this runner's own, because the cache keeps an entry for every file a process loads, including
   * the throwaway fixtures of the tests, and Node's default directory would grow with every run.
   */
  #cacheDir?: string;
  /** Stryker's pool disposes a runner whose init has not settled yet, so dispose waits for it. */
  #initialized?: Promise<void>;
  readonly #patterns: string[];
  readonly #nodeArgs: string[];
  readonly #dryRunConcurrency: number;
  readonly #dryRunStore: LzDryRunStore;
  readonly #memoryLimits: MemoryLimits;
  readonly #startUps: LzStartUps;
  readonly #allowEmpty: boolean;
  readonly #stallMs: number;
  readonly #log: Logger;

  constructor(options: RunnerStrykerOptions, log: Logger) {
    const lzNodeTest = parseOptions(options.lzNodeTest);
    const patterns = lzNodeTest.testFiles ?? defaults.testFiles.default;
    // Only the dry run gets Stryker's --testFiles; the mutant runs of other workers must find those files too.
    this.#patterns = [...patterns, ...options.testFiles];
    this.#dryRunFilesKey = JSON.stringify([process.cwd(), ...this.#patterns]);
    this.#nodeArgs = withoutReporters(lzNodeTest.nodeArgs ?? defaults.nodeArgs.default);
    this.#dryRunConcurrency = lzTestRunnerConcurrency(
      options.concurrency,
      options.checkers.length > 0,
      availableParallelism(),
    );
    this.#dryRunStore = lzDryRunStore(lzDryRunDir(dryRunOwner));
    this.#memoryLimits = memoryLimits(lzNodeTest.maxMemoryMB, this.#dryRunStore, log);
    this.#startUps = lzStartUps(this.#dryRunStore, options.timeoutFactor, log);
    this.#allowEmpty = options.allowEmpty;
    this.#stallMs = options.timeoutMS;
    this.#log = log;
  }

  capabilities(): TestRunnerCapabilities {
    return { reloadEnvironment: true };
  }

  init(): Promise<void> {
    this.#initialized = this.#init();

    return this.#initialized;
  }

  async #init(): Promise<void> {
    const { node } = process.versions;

    if (!supportsNode(node)) {
      throw new Error(
        `The lz-node-test test runner needs Node.js ${lzMinNodeVersion.join('.')} or later, and this is Node.js ${node}.`,
      );
    }

    // glob gives a file once per spelling, relative for a relative pattern and absolute for an absolute one.
    const files: string[] = [];

    for await (const file of glob(this.#patterns, { exclude: (name) => name === 'node_modules' })) {
      files.push(resolve(file));
    }

    this.#testFiles = [...new Set(files)].sort();

    if (this.#testFiles.length === 0) {
      const message = `No test files match ${JSON.stringify(this.#patterns)}`;

      if (!this.#allowEmpty) {
        throw new Error(message);
      }

      this.#log.warn(`${message}; running none, as allowEmpty is set.`);
    }

    removeLeftDirs(tmpdir());

    if (process.env['NODE_COMPILE_CACHE'] === undefined) {
      this.#cacheDir = mkdtempSync(join(tmpdir(), lzDirPrefix('cache', process.pid)));
    }
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([this.#initialized]);

    if (this.#cacheDir !== undefined) {
      await removeDir(this.#cacheDir, this.#log);
    }
  }

  async dryRun(options: DryRunOptions): Promise<DryRunResult> {
    const files = options.testFiles?.length ? options.testFiles.map((file) => resolve(file)) : this.#testFiles;
    const run = {
      dryRun: true,
      disableBail: options.disableBail,
      coverageAnalysis: options.coverageAnalysis,
      instrumented: new Set(options.files?.map((file) => resolve(file))),
    } satisfies LzRunOptions;
    const memoryLimitMB = this.#memoryLimits.forDryRun();
    this.#dryRunStore.start();
    this.#dryRunStore.write(this.#dryRunFilesKey, 'files', JSON.stringify(files));
    this.#dryRunFiles = files;

    // The dry run runs as many files at once as Stryker later runs test runners for the mutants, so the test times it
    // reports, which size each mutant's timeout, include the slowdown of processes competing for the cores.
    const result = await this.#run(
      files,
      run,
      this.#dryRunConcurrency,
      (file) => this.runFile(file, run, memoryLimitMB),
      // The same fileMs as every test's time, so the start-up a mutant run's deadline takes off is never more than the
      // time Stryker's timeout counted for it.
      (file, fileRun, fileMs) => {
        this.#memoryLimits.record(file, fileRun.records);
        this.#startUps.record(
          file,
          lzStartUpOf(
            fileRun.records.flatMap((record) => record.tests),
            fileMs,
          ),
        );
      },
    );

    if (
      result.status === DryRunStatus.Complete &&
      result.mutantCoverage &&
      !hasHits(result.mutantCoverage) &&
      result.tests.some((test) => test.status !== TestStatus.Skipped)
    ) {
      this.#log.warn(
        "The dry run's tests reached no mutated code, so Stryker will report every mutant as NoCoverage. Likely " +
          'causes: the tests import built code, such as dist/, instead of the source files Stryker mutates, or the ' +
          "code under test lies outside Stryker's sandbox.",
      );
    }

    return result;
  }

  async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const started = performance.now();
    this.#dryRunFiles ??= lzStoredFiles(this.#dryRunFilesKey, this.#dryRunStore.read(this.#dryRunFilesKey, 'files'));
    const files = lzFilesFor(this.#dryRunFiles ?? this.#testFiles, options.testFilter);
    // Stryker's own timer stays as the backstop, and a Timeout the runner reports keeps Stryker's worker.
    const deadlineMs = Math.ceil(this.#startUps.deadline(files, options.testFilter, options.timeout));
    const deadline = {
      signal: AbortSignal.timeout(deadlineMs),
      reason:
        `Passed the runner's deadline of ${deadlineMs} ms, which counts each test file's start-up once ` +
        `(Stryker's timeout: ${Math.round(options.timeout)} ms)`,
    };
    const run = {
      dryRun: false,
      disableBail: options.disableBail,
      activeMutant: options.activeMutant.id,
      mutantActivation: options.mutantActivation,
      hitLimit: options.hitLimit,
      testFilter: options.testFilter,
    } satisfies LzRunOptions;
    const result = await this.#run(files, run, 1, (file) =>
      this.runFile(file, run, this.#memoryLimits.forMutantRun(file), deadline),
    );
    const mutantResult = toMutantRunResult(result);

    // toMutantRunResult sums the test times, which count each file's time outside its tests once per test. A mutant
    // run runs one file at a time, so its own time is the time of the file runs it made, each its process with the
    // setup and removal of its run directory.
    return 'duration' in mutantResult
      ? { ...mutantResult, duration: Math.round(performance.now() - started) }
      : mutantResult;
  }

  async #run(
    files: string[],
    run: LzRunOptions,
    limit: number,
    runOne: (file: string) => Promise<LzFileRun>,
    /** Told of each file's run and its time, `fileMs`, the time that `lzToTestResults` spreads over the file's tests. */
    afterRun?: (file: string, fileRun: LzFileRun, fileMs: number) => void,
  ): Promise<DryRunResult> {
    const tests: TestResult[] = [];
    const coverages: (MutantCoverage | undefined)[] = [];
    const ends = (outcome: FileOutcome) => 'end' in outcome || (!run.disableBail && outcome.failed);
    const outcomes = await lzRunInPool(
      files,
      limit,
      async (file) => {
        const started = performance.now();
        const fileRun = await runOne(file);
        const fileMs = performance.now() - started;
        afterRun?.(file, fileRun, fileMs);

        return fileOutcome(file, fileRun, fileMs, run);
      },
      ends,
    );

    for (const outcome of outcomes) {
      if ('end' in outcome) {
        // With bail disabled, the tests that failed before a later file timed out still kill the mutant.
        const killedBefore =
          !run.dryRun &&
          outcome.end.status === DryRunStatus.Timeout &&
          tests.some((test) => test.status === TestStatus.Failed);

        if (!killedBefore) {
          return outcome.end;
        }

        break;
      }

      tests.push(...outcome.results);
      coverages.push(...outcome.coverages);
    }

    // Mutant runs leave coverageAnalysis unset and so merge coverage too; toMutantRunResult drops it.
    return {
      status: DryRunStatus.Complete,
      tests,
      ...(run.coverageAnalysis !== 'off' && {
        mutantCoverage: (run.coverageAnalysis === 'all' ? lzMergeAsStatic : lzMergeCoverage)(coverages),
      }),
    };
  }

  /** Ends the file's process, and what processEnd ends with it, once `deadline` aborts, also when it already has. */
  async runFile(file: string, run: LzRunOptions, memoryLimitMB?: number, deadline?: LzDeadline): Promise<LzFileRun> {
    const runDir = mkdtempSync(join(tmpdir(), lzDirPrefix('run', process.pid)));
    const outDir = join(runDir, 'out');
    const tmpDir = join(runDir, 'tmp');

    try {
      mkdirSync(outDir);
      mkdirSync(tmpDir);
      const nodeOptions = lzConsumerNodeOptions(process.env);
      const env = lzRunEnv({
        base: process.env,
        file,
        outDir,
        tmpDir,
        run,
        cacheDir: this.#cacheDir,
        nodeOptions,
        memoryLimitMB,
        heldOpenMs: shortenedHeldOpen.get(this),
        stallMs: this.#stallMs,
      });
      const fileArgs = [...this.#nodeArgs, file];
      const args = [`--test-reporter=${reporterUrl}`, ...fileArgs];

      if (this.#log.isDebugEnabled()) {
        this.#log.debug(`Running: \`${nodeCommand(args)}\` in ${process.cwd()}`);
      }

      const child = spawn(process.execPath, args, {
        env,
        // stdin an open pipe that never ends, as node --test gives each test file: on an ended stdin, a test that hands
        // process.stdin to a subprocess can wait forever.
        stdio: ['pipe', 'ignore', 'pipe'],
        ...groupOptions(process.platform),
      });
      let killedByDeadline: string | undefined;
      let exited = false;
      child.once('exit', () => {
        exited = true;
      });
      const end = () => {
        // A process that already exited is settling, which the deadline cannot make longer.
        if (!exited) {
          killedByDeadline = deadline?.reason;
          child.kill('SIGKILL');
        }
      };

      if (deadline?.signal.aborted) {
        end();
      }

      deadline?.signal.addEventListener('abort', end);
      const { exitCode, stderr } = await processEnd(child, process.platform).finally(() => {
        deadline?.signal.removeEventListener('abort', end);
      });
      let unreadable: string | undefined;
      const records = readdirSync(outDir)
        .filter(lzIsRecordName)
        .flatMap((name) => {
          try {
            return [lzParseRecord(readFileSync(join(outDir, name), 'utf8'))];
          } catch (error) {
            // lzWriteRecord leaves a whole record or none, so this is a file that something else wrote at a record's
            // name, or one that cannot be read.
            unreadable = `${name}: ${error instanceof Error ? error.message : String(error)}`;

            return [];
          }
        });

      return {
        records,
        exitCode,
        stderr,
        fileArgs,
        nodeOptions,
        ...(unreadable && { unreadable }),
        ...(killedByDeadline !== undefined && { killedByDeadline }),
      };
    } finally {
      await removeDir(runDir, this.#log);
    }
  }
}

export const strykerPlugins = [declareClassPlugin(PluginKind.TestRunner, 'lz-node-test', LzNodeTestTestRunner)];

export const strykerValidationSchema = schema;
