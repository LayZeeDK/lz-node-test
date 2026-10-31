import { randomUUID } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';

import type { MutantCoverage, Position } from '@stryker-mutator/api/core';

import { isNumber, isObject, isString, isStrings, optional } from './guards.ts';

export function testId(parent: string, name: string): string {
  return `${parent} > ${/(^| )>( |$)/.test(name) ? name.replace(/[\\>]/g, '\\$&') : name}`;
}

export function afterHookId(testFile: string): string {
  return testId(testFile, '"after" hook');
}

/** node:test reports in declaration order, so the wrapper and the reporter number alike. */
export function uniqueIds(): (parent: string, name: string) => string {
  const used = new Set<string>();

  return (parent, name) => {
    const base = testId(parent, name);

    let id = base;

    for (let count = 2; used.has(id); count++) {
      id = `${base} (${count})`;
    }

    used.add(id);

    return id;
  };
}

export function within(id: string, scope: string): boolean {
  return id === scope || id.startsWith(`${scope} > `);
}

export interface RecordedTest {
  readonly id: string;
  /** Skipped tests include todo tests, which run but whose outcome node:test ignores. */
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly failureMessage?: string;
  readonly timeSpentMs: number;
  readonly startPosition?: Position;
}

/**
 * A span of time in milliseconds on the machine's monotonic clock, as `process.hrtime` reads it: it does not step, and
 * every process and thread of the machine reads the same clock, which the wall clock and `performance.timeOrigin` do
 * not to the millisecond.
 */
export interface LzTimeWindow {
  readonly start: number;
  readonly end: number;
}

interface MemoryLimitReached {
  readonly rssMB: number;
  readonly limitMB: number;
}

export interface ProcessRecord {
  readonly main?: true;
  readonly tests: readonly RecordedTest[];
  // undefined: the record goes through JSON.stringify, which leaves such a field out.
  readonly hitCount?: number | undefined;
  readonly mutantCoverage?: MutantCoverage | undefined;
  readonly peakMemoryMB?: number | undefined;
  readonly memoryLimitReached?: MemoryLimitReached;
  readonly diagnostics?: readonly string[];
  /**
   * Set when the test file's process exited before node:test's summary through process.exit() or an uncaught
   * exception, which skip `beforeExit`, unless the hook ended it once node:test had reported every top-level suite and
   * test.
   */
  readonly unfinished?: true;
  /** What kept the test file's process alive after its tests and root `after` hooks, when the hook ended it for that. */
  readonly heldOpen?: readonly string[];
  /** From when the hook ran in the process or thread to when it wrote this record. */
  readonly lifetime?: LzTimeWindow;
  /**
   * The test file's own record: by test id, the spans during which the test is current, so a process or thread started
   * then reads it as its current test. A span ends when another test becomes current; a pause in which no test is
   * current between two spans of one test joins them.
   */
  readonly testSpans?: Readonly<Record<string, readonly LzTimeWindow[]>>;
}

export const envNames = Object.freeze({
  out: 'LZ_STRYKER_NODE_TEST_OUT',
  file: 'LZ_STRYKER_NODE_TEST_FILE',
  dryRun: 'LZ_STRYKER_NODE_TEST_DRY_RUN',
  hitLimit: 'LZ_STRYKER_NODE_TEST_HIT_LIMIT',
  memoryLimit: 'LZ_STRYKER_NODE_TEST_MEMORY_LIMIT_MB',
  current: 'LZ_STRYKER_NODE_TEST_CURRENT',
  filter: 'LZ_STRYKER_NODE_TEST_FILTER',
  bail: 'LZ_STRYKER_NODE_TEST_BAIL',
  activeMutant: 'LZ_STRYKER_NODE_TEST_ACTIVE_MUTANT',
  heldOpen: 'LZ_STRYKER_NODE_TEST_HELD_OPEN_MS',
});

/**
 * How long a test file's process may stay alive after its tests and root `after` hooks when the ending does not end it
 * at once for a failed test. The tests shorten it through envNames.heldOpen; it is not an option.
 */
export const heldOpenMs = 30_000;

/** Stryker's variable for the active mutant, which instrumented code reads when it loads. */
export const activeMutantEnv = '__STRYKER_ACTIVE_MUTANT__';

/**
 * Tells apart the records of processes that had the same pid, as a pid can come back within one file run. The test
 * file's own record goes without one, so the runner finds it by the pid of the process it started.
 */
export function lzRecordNonce(): string {
  return randomUUID();
}

export function recordName(pid: number, threadId: number, nonce?: string): string {
  return nonce === undefined ? `${pid}.${threadId}.json` : `${pid}.${threadId}.${nonce}.json`;
}

/** The record the memory watchdog writes when it ends its process. */
export function memoryRecordName(pid: number, nonce: string): string {
  return `${pid}.${nonce}.memory.json`;
}

/** Where a record is written before it is renamed to `path`, so that a reader finds every record whole. */
export function lzTempRecordPath(path: string): string {
  return `${path}.tmp`;
}

/** What `lzWriteRecord` takes from the process. */
export interface LzRecordFiles {
  readonly write: (path: string, data: string) => void;
  readonly rename: (from: string, to: string) => void;
  /** Blocks the thread for `ms`: a record is written in exit listeners, which run no timer. */
  readonly pause: (ms: number) => void;
  readonly platform: NodeJS.Platform;
}

const nodeFiles: LzRecordFiles = {
  write: writeFileSync,
  rename: renameSync,
  pause: (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
  platform: process.platform,
};

/**
 * How often, and how far apart, `lzWriteRecord` renames on Windows, where a rename over a file that another process has
 * open, as the runner reading the record or a virus scanner the new temporary file, fails with EPERM or EBUSY: at most
 * 40 ms in all.
 */
const renameAttempts = 5;
const renameRetryMs = 10;

function isBusy(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EBUSY');
}

/**
 * Writes `record` to `lzTempRecordPath(path)` and renames that over `path`, so that a reader finds the record whole, and
 * a kill during the write leaves the one before.
 */
export function lzWriteRecord(path: string, record: ProcessRecord, files: LzRecordFiles = nodeFiles): void {
  const temp = lzTempRecordPath(path);
  files.write(temp, JSON.stringify(record));

  for (let attempt = 1; ; attempt++) {
    try {
      files.rename(temp, path);

      return;
    } catch (error) {
      if (files.platform !== 'win32' || attempt === renameAttempts || !isBusy(error)) {
        throw error;
      }
    }

    files.pause(renameRetryMs);
  }
}

const recordNamePattern = /^\d+\.(?:\d+(?:\.[\da-f-]+)?|[\da-f-]+\.memory)\.json$/;

/** Whether `name` is the name of a record, which a record's temporary file is not. */
export function lzIsRecordName(name: string): boolean {
  return recordNamePattern.test(name);
}

function notARecord(field?: string): never {
  const message = 'not a record of test results';

  throw new Error(field === undefined ? message : `${message}: ${field}`);
}

const isTrue = (value: unknown) => value === true;
const isCounts = (value: unknown) => isObject(value) && Object.values(value).every(isNumber);
const isPosition = (value: unknown): value is Position =>
  isObject(value) && isNumber(value['line']) && isNumber(value['column']);
const isMemoryLimit = (value: unknown): value is MemoryLimitReached =>
  isObject(value) && isNumber(value['rssMB']) && isNumber(value['limitMB']);
const isWindow = (value: unknown): value is LzTimeWindow =>
  isObject(value) && isNumber(value['start']) && isNumber(value['end']);
const isSpans = (value: unknown): value is Record<string, LzTimeWindow[]> =>
  isObject(value) && Object.values(value).every((spans) => Array.isArray(spans) && spans.every(isWindow));
const isCoverage = (value: unknown): value is MutantCoverage =>
  isObject(value) &&
  isCounts(value['static']) &&
  isObject(value['perTest']) &&
  Object.values(value['perTest']).every(isCounts);

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
    ...optional('failureMessage', failureMessage, isString, notARecord, `${path}.failureMessage`),
    ...optional('startPosition', startPosition, isPosition, notARecord, `${path}.startPosition`),
  };
}

export function lzParseRecord(json: string): ProcessRecord {
  const record: unknown = JSON.parse(json);

  if (!isObject(record)) {
    notARecord();
  }

  const {
    tests,
    main,
    hitCount,
    mutantCoverage,
    peakMemoryMB,
    memoryLimitReached,
    diagnostics,
    unfinished,
    heldOpen,
    lifetime,
    testSpans,
  } = record;

  if (!Array.isArray(tests)) {
    notARecord('tests');
  }

  return {
    tests: tests.map((test, index) => parseTest(test, `tests[${index}]`)),
    ...optional('main', main, isTrue, notARecord),
    ...optional('hitCount', hitCount, isNumber, notARecord),
    ...optional('mutantCoverage', mutantCoverage, isCoverage, notARecord),
    ...optional('peakMemoryMB', peakMemoryMB, isNumber, notARecord),
    ...optional('memoryLimitReached', memoryLimitReached, isMemoryLimit, notARecord),
    ...optional('diagnostics', diagnostics, isStrings, notARecord),
    ...optional('unfinished', unfinished, isTrue, notARecord),
    ...optional('heldOpen', heldOpen, isStrings, notARecord),
    ...optional('lifetime', lifetime, isWindow, notARecord),
    ...optional('testSpans', testSpans, isSpans, notARecord),
  };
}
