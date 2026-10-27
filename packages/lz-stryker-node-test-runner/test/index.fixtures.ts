import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';

import { INSTRUMENTER_CONSTANTS, type MutantCoverage } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import {
  DryRunStatus,
  MutantRunStatus,
  TestStatus,
  type CompleteDryRunResult,
  type DryRunOptions,
  type DryRunResult,
  type MutantRunOptions,
  type MutantRunResult,
  type TestResult,
} from '@stryker-mutator/api/test-runner';

import { LzStrykerNodeTestRunner, lzRunEnv, type LzStrykerNodeTestOptions } from '../src/index.ts';

export const activeMutant = INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE;
export const hookUrl = pathToFileURL(join(import.meta.dirname, '..', 'src', 'hook.ts')).href;
export const reporterArg = `--test-reporter=${pathToFileURL(join(import.meta.dirname, '..', 'src', 'reporter.ts')).href}`;

export function runNodeOptions(): string {
  return lzRunEnv(process.env, '', '', '', { dryRun: false, disableBail: false }, undefined).NODE_OPTIONS;
}

/**
 * A process id that no process has: above the largest that Linux (2^22) and macOS (99999) hand out, and one that
 * Windows reports as not running. The id of a process that ended can be handed out again at once.
 */
export const noProcess = 2 ** 31 - 1;

export const cover = [
  'const cover = (id) => {',
  '  const ns = globalThis.__stryker__;',
  '  const coverage = (ns.mutantCoverage ??= { static: {}, perTest: {} });',
  '  const hits = ns.currentTestId ? (coverage.perTest[ns.currentTestId] ??= {}) : coverage.static;',
  '  hits[id] = (hits[id] ?? 0) + 1;',
  '};',
].join(' ');

const fixtureHeader = [
  "import assert from 'node:assert/strict';",
  "import { spawnSync } from 'node:child_process';",
  "import { describe, it } from 'node:test';",
  cover,
];

export const fixtureHeaderLines = fixtureHeader.length;

export function fixture(...lines: string[]): string {
  return [...fixtureHeader, ...lines, ''].join('\n');
}

export const passing = fixture("it('passes', () => {});");

export const grows =
  'const held = []; const end = Date.now() + 5_000; while (Date.now() < end) { ' +
  'if (held.length < 25) held.push(new Int32Array(4e6).fill(1)); const pause = Date.now() + 10; while (Date.now() < pause); }';
export const failing = fixture("it('fails', () => { throw new Error('expected failure'); });");

export function project(t: TestContext, files: Record<string, string>): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'node-test-runner-')));
  const previous = process.cwd();

  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }

  process.chdir(dir);
  t.after(() => {
    process.chdir(previous);
    // Windows refuses to remove a directory that a process the test just ended still works in.
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  return dir;
}

export function logger(debug: string[] = [], debugEnabled = true, warnings: string[] = []): Logger {
  const no = () => false;
  const ignore = () => {};

  return {
    isTraceEnabled: no,
    isDebugEnabled: () => debugEnabled,
    isInfoEnabled: no,
    isWarnEnabled: no,
    isErrorEnabled: no,
    isFatalEnabled: no,
    trace: ignore,
    debug: (message: string) => {
      debug.push(message);
    },
    info: ignore,
    warn: (message: string) => {
      warnings.push(message);
    },
    error: ignore,
    fatal: ignore,
  };
}

export interface RunnerOptions {
  readonly lzStrykerNodeTest?: LzStrykerNodeTestOptions;
  readonly testFiles?: readonly string[];
  readonly concurrency?: number;
  readonly checkers?: readonly string[];
  readonly allowEmpty?: boolean;
}

export function strykerOptions({
  testFiles = [],
  checkers = [],
  ...options
}: RunnerOptions = {}): ConstructorParameters<typeof LzStrykerNodeTestRunner>[0] {
  return { allowEmpty: false, ...options, testFiles: [...testFiles], checkers: [...checkers] };
}

/** The member `key` of a value from a module whose types the tests cannot reach; nothing when it has none. */
export function member(value: unknown, key: string): unknown {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? Reflect.get(value, key)
    : undefined;
}

export function callMember(target: unknown, name: string, ...args: unknown[]): unknown {
  const fn = member(target, name);

  if (typeof fn !== 'function') {
    throw new TypeError(`There is no ${name} method to call.`);
  }

  const result: unknown = Reflect.apply(fn, target, args);

  return result;
}

export function construct(target: unknown, args: unknown[]): unknown {
  if (typeof target !== 'function') {
    throw new TypeError('There is no class to construct.');
  }

  const instance: unknown = Reflect.construct(target, args);

  return instance;
}

export async function initRunner(
  testFiles: string[] | undefined,
  lzStrykerNodeTest: LzStrykerNodeTestOptions = {},
): Promise<LzStrykerNodeTestRunner> {
  const options = { lzStrykerNodeTest: { ...lzStrykerNodeTest, ...(testFiles && { testFiles }) } };
  const runner = new LzStrykerNodeTestRunner(strykerOptions(options), logger());
  await runner.init();

  return runner;
}

export const dryRun: DryRunOptions = { timeout: 10_000, disableBail: false, coverageAnalysis: 'perTest' };

export function mutantRunOptions(options: Partial<MutantRunOptions> = {}): MutantRunOptions {
  return {
    timeout: 10_000,
    disableBail: false,
    // Not a number, so it never activates a mutant in an instrumented copy of the hook.
    activeMutant: {
      id: 'fixture-mutant',
      fileName: 'fixture.ts',
      mutatorName: 'Fixture',
      replacement: '',
      location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
    },
    sandboxFileName: 'sandbox',
    mutantActivation: 'runtime',
    reloadEnvironment: true,
    ...options,
  };
}

export function complete(result: DryRunResult): CompleteDryRunResult {
  assert.strictEqual(result.status, DryRunStatus.Complete, `expected a complete run, got ${JSON.stringify(result)}`);

  return result;
}

export function withoutDuration(
  result: MutantRunResult,
): MutantRunResult extends infer R ? (R extends unknown ? Omit<R, 'duration'> : never) : never {
  if (result.status === MutantRunStatus.Killed || result.status === MutantRunStatus.Survived) {
    const { duration, ...rest } = result;

    assert.ok((duration ?? -1) >= 0, `expected a duration, got ${JSON.stringify(result)}`);

    return rest;
  }

  return result;
}

/**
 * The fixture's own coverage. Under Stryker the runner under test is instrumented too, so its numeric mutant ids
 * reach the coverage that the fixture's processes report.
 */
export function fixtureCoverage(coverage: MutantCoverage | undefined): MutantCoverage | undefined {
  const own = (hits: Record<string, number>) =>
    Object.fromEntries(Object.entries(hits).filter(([id]) => !/^\d+$/.test(id)));

  return (
    coverage && {
      static: own(coverage.static),
      perTest: Object.fromEntries(
        Object.entries(coverage.perTest)
          .map(([test, hits]): [string, Record<string, number>] => [test, own(hits)])
          .filter(([, hits]) => Object.keys(hits).length > 0),
      ),
    }
  );
}

let stalled = false;
const stalledExitDelayMs = 10_000;

export function ownCacheDirs(): string[] {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith(`lz-stryker-node-test-cache-${process.pid}-`))
    .sort();
}

export async function settle<T>(run: Promise<T>, ms = 5_000): Promise<T> {
  assert.ok(!stalled, 'an earlier run never ended');
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      run,
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => {
          stalled = true;
          // A stalled run can leave a blocked process behind that would keep this one alive. Every later run fails
          // at once on `stalled`, so the process only has to outlive the reporting of those failures.
          setTimeout(() => {
            process.exit(1);
          }, stalledExitDelayMs).unref();
          fail(new Error(`the run did not end within ${ms} ms`));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function shareCompileCache(): string {
  const cacheDir = mkdtempSync(join(tmpdir(), 'node-test-runner-cache-'));
  process.env['NODE_COMPILE_CACHE'] = cacheDir;

  // Removed on exit, so a process that dies early (which happens under mutation testing) leaves nothing. The runners
  // the tests never dispose (a mutant of the runner can give each one a directory) are swept here too.
  process.prependListener('exit', () => {
    for (const dir of [cacheDir, ...ownCacheDirs().map((name) => join(tmpdir(), name))]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // A process a test started may still hold a file for a moment; the next run removes its own directory anyway.
      }
    }
  });

  return cacheDir;
}

export function summary(tests: TestResult[]) {
  return tests.map((test) => ({
    id: test.id,
    status: test.status,
    failureMessage: test.status === TestStatus.Failed ? test.failureMessage : undefined,
  }));
}
