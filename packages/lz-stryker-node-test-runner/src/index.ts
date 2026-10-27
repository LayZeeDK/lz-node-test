import { spawn } from 'node:child_process';
import { globSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  INSTRUMENTER_CONSTANTS,
  type CoverageAnalysis,
  type MutantCoverage,
  type Position,
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

import { removeDir, removeLeftDirs } from './dirs.ts';
import { envNames, recordName, testId, within, type ProcessRecord, type RecordedTest } from './hook-core.ts';
import { memoryLimits, peakMemoryDir, type MemoryLimits } from './memory-limits.ts';
import { groupOptions, processEnd } from './process-end.ts';
import type { MemoryLimitReached } from './watchdog.ts';
import schema from './schema/node-test-runner-options.json' with { type: 'json' };

/** Options under `lzStrykerNodeTest` in the Stryker configuration, which `schema/node-test-runner-options.json` describes. */
export interface LzStrykerNodeTestOptions {
  readonly testFiles?: readonly string[];
  readonly nodeArgs?: readonly string[];
  readonly maxMemoryMB?: number;
}

const defaults = schema.properties.lzStrykerNodeTest.properties;

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
      readonly activeMutant?: undefined;
      readonly mutantActivation?: undefined;
      readonly hitLimit?: undefined;
      readonly testFilter?: undefined;
    }
  | {
      readonly dryRun: false;
      readonly disableBail: boolean;
      readonly coverageAnalysis?: undefined;
      readonly activeMutant?: string;
      readonly mutantActivation?: MutantActivation;
      // undefined as Stryker's MutantRunOptions give them: no hit limit, every test.
      readonly hitLimit?: number | undefined;
      readonly testFilter?: readonly string[] | undefined;
    };

export interface LzFileRun {
  readonly records: readonly ProcessRecord[];
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly args: readonly string[];
  readonly nodeOptions: string;
  readonly unreadable?: string;
}

// .ts from the source, .js from the build.
const ext = extname(import.meta.filename);
const hookUrl = pathToFileURL(resolve(import.meta.dirname, `hook${ext}`)).href;
const reporterUrl = pathToFileURL(resolve(import.meta.dirname, `reporter${ext}`)).href;
const closeGraceMs = 1_500;

/** Without `perTest`, the hits inside tests count as static, as Stryker's coverage analysis `all` expects. */
export function lzMergeCoverage(coverages: (MutantCoverage | undefined)[], perTest: boolean): MutantCoverage {
  const total: MutantCoverage = { static: {}, perTest: {} };
  const add = (into: Record<string, number>, from: Record<string, number>) => {
    for (const [mutantId, hits] of Object.entries(from)) {
      into[mutantId] = (into[mutantId] ?? 0) + hits;
    }
  };

  for (const coverage of coverages) {
    if (!coverage) {
      continue;
    }

    add(total.static, coverage.static);

    for (const [testId, hits] of Object.entries(coverage.perTest)) {
      add(perTest ? (total.perTest[testId] ??= {}) : total.static, hits);
    }
  }

  return total;
}

/**
 * A test's name leaves out the test file, which its id starts with, as Stryker's runners name tests after their suites
 * only.
 *
 * Each test's time includes the time the file's run, `fileMs`, spent outside its outermost tests, whose time includes
 * their subtests': running any test of the file runs the file's whole process. Stryker's mutant timeout scales with
 * the summed time of the tests it runs, so it then scales with the processes it starts, which Stryker's other workers
 * slow down as well.
 */
export function lzToTestResults(testFile: string, recorded: RecordedTest[], fileMs: number): TestResult[] {
  const prefix = testId(testFile, '');
  const outermost = recorded.filter((test) => !recorded.some((other) => other !== test && within(test.id, other.id)));
  const outside = fileMs - outermost.reduce((sum, test) => sum + test.timeSpentMs, 0);

  return recorded.map((test) => {
    const base = {
      id: test.id,
      name: test.id.slice(prefix.length),
      fileName: testFile,
      timeSpentMs: Math.round(test.timeSpentMs + outside),
      ...(test.startPosition && { startPosition: test.startPosition }),
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

/** Reports a test file that failed outside its tests as Stryker's tap runner does: command, diagnostics, stderr. */
export function lzFileError(testFile: string, { records, exitCode, stderr, args, nodeOptions }: LzFileRun): string {
  const diagnostics = records.flatMap((record) => record.diagnostics ?? []);
  const heldOpen = records.flatMap((record) => record.heldOpen ?? []);
  const output = stderr.trim();

  return [
    `Error running file "${testFile}": node exited with code ${exitCode} outside any test.`,
    `To reproduce it, run \`${nodeCommand(args)}\` in ${process.cwd()} with NODE_OPTIONS set to \`${nodeOptions}\`.`,
    ...(heldOpen.length > 0
      ? [
          `It stayed alive after its tests, held open by ${heldOpen.join(', ')}, until the runner ended it; node:test ` +
            'reports an error raised after a test ended only when its process ends by itself.',
        ]
      : []),
    ...(diagnostics.length > 0 ? ['Diagnostics:', ...diagnostics] : []),
    ...(output ? ['Stderr:', output] : []),
  ].join('\n');
}

/**
 * Leaves out node's options that add a node:test reporter or a reporter destination, with their values, so the
 * runner's reporter is the only one; node refuses more reporters than destinations. An argument may be quoted, as in
 * NODE_OPTIONS.
 */
function withoutReporters(args: readonly string[]): string[] {
  const reporterOption = (arg: string) => /^--test-reporter(?:-destination)?(=|$)/.exec(arg.replaceAll('"', ''));

  // A reporter option without `=` takes the next argument as its value.
  return args.filter((arg, index) => !reporterOption(arg) && reporterOption(String(args[index - 1]))?.[1] !== '');
}

function notARecord(field?: string): never {
  const message = 'not a record of test results';

  throw new Error(field === undefined ? message : `${message}: ${field}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isNumber = (value: unknown) => typeof value === 'number';
const isString = (value: unknown) => typeof value === 'string';
const isTrue = (value: unknown) => value === true;
const isStrings = (value: unknown) => Array.isArray(value) && value.every(isString);
const isCounts = (value: unknown) => isObject(value) && Object.values(value).every(isNumber);
const isPosition = (value: unknown): value is Position =>
  isObject(value) && isNumber(value['line']) && isNumber(value['column']);
const isMemoryLimit = (value: unknown): value is MemoryLimitReached =>
  isObject(value) && isNumber(value['rssMB']) && isNumber(value['limitMB']);
const isCoverage = (value: unknown): value is MutantCoverage =>
  isObject(value) &&
  isCounts(value['static']) &&
  isObject(value['perTest']) &&
  Object.values(value['perTest']).every(isCounts);

/** `value` under `key` when it is there and passes `check`, which `field` names; nothing when it is not there. */
function optional<TKey extends string, T>(
  key: TKey,
  value: unknown,
  check: (value: unknown) => value is T,
  field: string = key,
  fail: (field: string) => never = notARecord,
): { [P in TKey]?: T } {
  const result: { [P in TKey]?: T } = {};

  if (value === undefined) {
    return result;
  }

  if (!check(value)) {
    fail(field);
  }

  result[key] = value;

  return result;
}

function parseTest(value: unknown, path: string): RecordedTest {
  if (!isObject(value)) {
    notARecord(path);
  }

  const { id, status, failureMessage, timeSpentMs, startPosition } = value;

  if (!isString(id)) {
    notARecord(`${path}.id`);
  }

  if (status !== 'passed' && status !== 'failed' && status !== 'skipped') {
    notARecord(`${path}.status`);
  }

  if (!isNumber(timeSpentMs)) {
    notARecord(`${path}.timeSpentMs`);
  }

  return {
    id,
    status,
    timeSpentMs,
    ...optional('failureMessage', failureMessage, isString, `${path}.failureMessage`),
    ...optional('startPosition', startPosition, isPosition, `${path}.startPosition`),
  };
}

export function lzParseRecord(json: string): ProcessRecord {
  const record: unknown = JSON.parse(json);

  if (!isObject(record)) {
    notARecord();
  }

  const { tests, main, hitCount, mutantCoverage, peakMemoryMB, memoryLimitReached, diagnostics, unfinished, heldOpen } =
    record;

  if (!Array.isArray(tests)) {
    notARecord('tests');
  }

  return {
    tests: tests.map((test, index) => parseTest(test, `tests[${index}]`)),
    ...optional('main', main, isTrue),
    ...optional('hitCount', hitCount, isNumber),
    ...optional('mutantCoverage', mutantCoverage, isCoverage),
    ...optional('peakMemoryMB', peakMemoryMB, isNumber),
    ...optional('memoryLimitReached', memoryLimitReached, isMemoryLimit),
    ...optional('diagnostics', diagnostics, isStrings),
    ...optional('unfinished', unfinished, isTrue),
    ...optional('heldOpen', heldOpen, isStrings),
  };
}

function notOptions(field?: string): never {
  const message = 'not valid lzStrykerNodeTest options';

  throw new Error(field === undefined ? message : `${message}: ${field}`);
}

/** Stryker checks the options against the schema first; this proves the fields the runner reads. */
function parseOptions(value: unknown): LzStrykerNodeTestOptions {
  if (value === undefined) {
    return {};
  }

  if (!isObject(value)) {
    notOptions();
  }

  const { testFiles, nodeArgs, maxMemoryMB } = value;

  return {
    ...optional('testFiles', testFiles, isStrings, 'testFiles', notOptions),
    ...optional('nodeArgs', nodeArgs, isStrings, 'nodeArgs', notOptions),
    ...optional('maxMemoryMB', maxMemoryMB, isNumber, 'maxMemoryMB', notOptions),
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
  const memoryLimitReached = records.find((record) => record.memoryLimitReached)?.memoryLimitReached;

  if (memoryLimitReached) {
    const { rssMB, limitMB } = memoryLimitReached;

    if (run.dryRun) {
      const errorMessage =
        `A process of "${file}" held ${rssMB} MB in the dry run, more than lzStrykerNodeTest.maxMemoryMB (${limitMB} MB), so ` +
        "its mutant runs would time out. Raise lzStrykerNodeTest.maxMemoryMB, or leave it out to derive each file's limit from " +
        'the dry run.';

      return { end: { status: DryRunStatus.Error, errorMessage } };
    }

    return { end: { status: DryRunStatus.Timeout, reason: `Memory limit reached (${rssMB}/${limitMB} MB)` } };
  }

  if (unreadable !== undefined) {
    return {
      end: { status: DryRunStatus.Error, errorMessage: `Unreadable test results for "${file}": ${unreadable}` },
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
  );
  const failed = results.some((result) => result.status === TestStatus.Failed);

  // Like Stryker's own runners, a failure that no test explains is an error, not a killed mutant.
  if (exitCode !== 0 && !failed) {
    return { end: { status: DryRunStatus.Error, errorMessage: lzFileError(file, fileRun) } };
  }

  const main = records.find((record) => record.main);

  if (!main) {
    const errorMessage =
      `Missing test results for "${file}": its process ended without writing them. Either the Stryker hook ` +
      'did not run in it, it left without running exit listeners (process.reallyExit, process.abort), or it ran ' +
      'under the permission model without write access to the temporary directory.';

    return { end: { status: DryRunStatus.Error, errorMessage } };
  }

  // The hook ended a file that something its tests opened kept alive, which `node --test` would wait for forever: in
  // the dry run an error to fix, and in a mutant run a timeout, which Stryker's own timer reports first unless the
  // file's tests take most of its budget. Top-level tests that node:test filters out never get reported, so such a
  // file can also be unfinished.
  if (!failed && main.heldOpen) {
    const heldBy = main.heldOpen.join(', ');

    if (run.dryRun) {
      const errorMessage =
        `Test file "${file}" stayed alive after its tests and root after hooks ended, held open by ${heldBy}, so ` +
        'node --test would not end either. Close what its tests open in an after hook, or pass --test-force-exit in ' +
        'lzStrykerNodeTest.nodeArgs, as for node --test (NODE_OPTIONS does not allow it); node:test then loses errors ' +
        'raised after the tests and root after hooks end.';

      return { end: { status: DryRunStatus.Error, errorMessage } };
    }

    return {
      end: { status: DryRunStatus.Timeout, reason: `Test file "${file}" stayed alive, held open by ${heldBy}` },
    };
  }

  // Stryker treats a test runner that exits during a run as crashed, whatever its exit code, and so do its runners
  // that run the tests in their own process; the tests that node:test did not report are unknown.
  if (!failed && main.unfinished) {
    const errorMessage =
      `Unfinished test results for "${file}": its process exited before node:test reported every test, as when ` +
      'a test calls process.exit().';

    return { end: { status: DryRunStatus.Error, errorMessage } };
  }

  return { results, coverages: records.map((record) => record.mutantCoverage), failed };
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

export function lzRunEnv(
  base: NodeJS.ProcessEnv,
  file: string,
  outDir: string,
  tmpDir: string,
  run: LzRunOptions,
  cacheDir: string | undefined,
  memoryLimitMB?: number,
): NodeJS.ProcessEnv & { NODE_OPTIONS: string } {
  const env: NodeJS.ProcessEnv & { NODE_OPTIONS: string } = {
    ...base,
    // The hook comes first, so a copy of this runner under test takes precedence over the runner running it.
    NODE_OPTIONS: [
      `--import ${JSON.stringify(hookUrl)}`,
      // node splits NODE_OPTIONS at spaces outside double quotes.
      ...withoutReporters(base['NODE_OPTIONS']?.match(/(?:[^\s"]|"(?:[^"\\]|\\.)*")+/g) ?? []),
    ].join(' '),
    [envNames.out]: outDir,
    [envNames.file]: file,
    [envNames.dryRun]: String(run.dryRun),
    // os.tmpdir() reads TMPDIR first on POSIX and TEMP first on Windows, then TMP.
    TMPDIR: tmpDir,
    TEMP: tmpDir,
    TMP: tmpDir,
  };

  const runState = [
    // Set when Stryker itself runs under `node --test`; node:test in the test file would then ignore `.only` and
    // write its report to stdout for an outer runner instead of using its reporters.
    'NODE_TEST_CONTEXT',
    envNames.current,
    envNames.hitLimit,
    envNames.memoryLimit,
    envNames.filter,
    envNames.bail,
    envNames.activeMutant,
    INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE,
  ];

  for (const key of runState) {
    delete env[key];
  }

  if (env['NODE_COMPILE_CACHE'] === undefined && cacheDir !== undefined) {
    env['NODE_COMPILE_CACHE'] = cacheDir;
  }

  // At runtime activation the hook activates the mutant once the tests start, so module-level code runs unmutated.
  if (run.activeMutant !== undefined) {
    const runtime = run.mutantActivation === 'runtime';
    env[runtime ? envNames.activeMutant : INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE] = run.activeMutant;
  }

  if (run.hitLimit !== undefined) {
    env[envNames.hitLimit] = String(run.hitLimit);
  }

  if (memoryLimitMB !== undefined) {
    env[envNames.memoryLimit] = String(memoryLimitMB);
  }

  if (run.testFilter) {
    env[envNames.filter] = JSON.stringify(run.testFilter);
  }

  // The dry run must run every test to collect each one's coverage.
  if (!run.dryRun && !run.disableBail) {
    env[envNames.bail] = 'true';
  }

  return env;
}

/** The Stryker options the runner reads, of all that Stryker passes it. */
type RunnerStrykerOptions = Pick<StrykerOptions, 'allowEmpty' | 'checkers' | 'concurrency' | 'testFiles'> & {
  readonly lzStrykerNodeTest?: unknown;
};

export class LzStrykerNodeTestRunner implements TestRunner {
  static inject = tokens(commonTokens.options, commonTokens.logger);

  #testFiles: string[] = [];
  /**
   * Every process compiles the hook and its imports; Node's compile cache makes that a one-time cost per runner.
   * The directory is this runner's own, because the cache keeps an entry for every file a process loads, including
   * the throwaway fixtures of the tests, and Node's default directory would grow with every run.
   */
  #cacheDir?: string;
  readonly #patterns: string[];
  readonly #nodeArgs: string[];
  readonly #dryRunConcurrency: number;
  readonly #memoryLimits: MemoryLimits;
  readonly #allowEmpty: boolean;
  readonly #log: Logger;

  constructor(options: RunnerStrykerOptions, log: Logger) {
    const lzStrykerNodeTest = parseOptions(options.lzStrykerNodeTest);
    const patterns = lzStrykerNodeTest.testFiles ?? defaults.testFiles.default;
    // Only the dry run gets Stryker's --testFiles; the mutant runs of other workers must find those files too.
    this.#patterns = [...patterns, ...options.testFiles];
    this.#nodeArgs = withoutReporters(lzStrykerNodeTest.nodeArgs ?? defaults.nodeArgs.default);
    this.#dryRunConcurrency = lzTestRunnerConcurrency(
      options.concurrency,
      options.checkers.length > 0,
      availableParallelism(),
    );
    this.#memoryLimits = memoryLimits(lzStrykerNodeTest.maxMemoryMB, peakMemoryDir(process.ppid), log);
    this.#allowEmpty = options.allowEmpty;
    this.#log = log;
  }

  capabilities(): TestRunnerCapabilities {
    return { reloadEnvironment: true };
  }

  async init(): Promise<void> {
    const { node } = process.versions;

    if (!supportsNode(node)) {
      throw new Error(
        `The lz-stryker-node-test test runner needs Node.js ${lzMinNodeVersion.join('.')} or later, and this is Node.js ${node}.`,
      );
    }

    // globSync returns a file once per spelling, relative for a relative pattern and absolute for an absolute one.
    const files = globSync(this.#patterns, { exclude: (name) => name === 'node_modules' }).map((file) => resolve(file));
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
      this.#cacheDir = mkdtempSync(join(tmpdir(), `lz-stryker-node-test-cache-${process.pid}-`));
    }
  }

  async dispose(): Promise<void> {
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
    } satisfies LzRunOptions;
    const memoryLimitMB = this.#memoryLimits.startDryRun();

    // The dry run runs as many files at once as Stryker later runs test runners for the mutants, so the test times it
    // reports, which size each mutant's timeout, include the slowdown of processes competing for the cores.
    return this.#run(files, run, this.#dryRunConcurrency, async (file) => {
      const fileRun = await this.runFile(file, run, memoryLimitMB);
      this.#memoryLimits.record(file, fileRun.records);

      return fileRun;
    });
  }

  async mutantRun(options: MutantRunOptions): Promise<MutantRunResult> {
    const started = performance.now();
    const run = {
      dryRun: false,
      disableBail: options.disableBail,
      activeMutant: options.activeMutant.id,
      mutantActivation: options.mutantActivation,
      hitLimit: options.hitLimit,
      testFilter: options.testFilter,
    } satisfies LzRunOptions;
    const result = await this.#run(lzFilesFor(this.#testFiles, options.testFilter), run, 1, (file) =>
      this.runFile(file, run, this.#memoryLimits.forMutantRun(file)),
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

        return fileOutcome(file, fileRun, performance.now() - started, run);
      },
      ends,
    );

    for (const outcome of outcomes) {
      if ('end' in outcome) {
        return outcome.end;
      }

      tests.push(...outcome.results);
      coverages.push(...outcome.coverages);
    }

    // Mutant runs leave coverageAnalysis unset and take the next return; toMutantRunResult drops their coverage.
    if (run.coverageAnalysis === 'off') {
      return { status: DryRunStatus.Complete, tests };
    }

    return {
      status: DryRunStatus.Complete,
      tests,
      mutantCoverage: lzMergeCoverage(coverages, run.coverageAnalysis !== 'all'),
    };
  }

  async runFile(file: string, run: LzRunOptions, memoryLimitMB?: number): Promise<LzFileRun> {
    const runDir = mkdtempSync(join(tmpdir(), `lz-stryker-node-test-${process.pid}-`));
    const outDir = join(runDir, 'out');
    const tmpDir = join(runDir, 'tmp');

    try {
      mkdirSync(outDir);
      mkdirSync(tmpDir);
      const env = lzRunEnv(process.env, file, outDir, tmpDir, run, this.#cacheDir, memoryLimitMB);
      const args = [`--test-reporter=${reporterUrl}`, ...this.#nodeArgs, file];

      if (this.#log.isDebugEnabled()) {
        this.#log.debug(`Running: \`${nodeCommand(args)}\` in ${process.cwd()}`);
      }

      const child = spawn(process.execPath, args, {
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
        ...groupOptions(process.platform),
      });
      const { exitCode, stderr } = await processEnd(child, closeGraceMs, process.platform);
      // processEnd rejects for a process that failed to start, the only kind without a pid.
      const mainRecord = child.pid === undefined ? undefined : recordName(child.pid, 0);
      let unreadable: string | undefined;
      const records = readdirSync(outDir).flatMap((name) => {
        try {
          return [lzParseRecord(readFileSync(join(outDir, name), 'utf8'))];
        } catch (error) {
          // A process that the tests started can still be writing its record when the grace period ends. The test
          // file's own process writes its record before it exits, unless the memory watchdog ends it mid-write.
          if (name === mainRecord) {
            unreadable = error instanceof Error ? error.message : String(error);
          }

          return [];
        }
      });

      return { records, exitCode, stderr, args, nodeOptions: env.NODE_OPTIONS, ...(unreadable && { unreadable }) };
    } finally {
      await removeDir(runDir, this.#log);
    }
  }
}

export const strykerPlugins = [
  declareClassPlugin(PluginKind.TestRunner, 'lz-stryker-node-test', LzStrykerNodeTestRunner),
];

export const strykerValidationSchema = schema;
