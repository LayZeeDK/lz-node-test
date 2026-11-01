import type { Logger } from '@stryker-mutator/api/logging';

import type { LzDryRunStore } from './dry-run-store.ts';
import { isObject } from './guards.ts';
import { lzOutsideMs, within, type RecordedTest } from './record.ts';

/** What a mutant run's deadline needs to know of a test file from the dry run. */
export interface LzStartUp {
  readonly startUpMs: number;
  readonly tests: number;
}

export function lzStartUpOf(tests: readonly RecordedTest[], fileMs: number): LzStartUp {
  return { startUpMs: Math.max(0, Math.floor(lzOutsideMs(tests, fileMs))), tests: tests.length };
}

/**
 * Each test file's start-up from the dry run, kept in the dry-run store that Stryker's own process owns and removes as it
 * exits (see `lzOwnDryRun`), so that every worker's mutant runs read what one worker's dry run measured. A worker's
 * runner cannot remove them: Stryker replaces runners while other workers still read them.
 */
export interface LzStartUps {
  record(file: string, startUp: LzStartUp): void;
  deadline(files: readonly string[], testFilter: readonly string[] | undefined, timeout: number): number;
}

export function lzStartUps(store: LzDryRunStore, timeoutFactor: number, log: Logger): LzStartUps {
  const unmeasured = new Set<string>();
  const read = (file: string) => {
    const startUp = storedStartUp(store.read(file, 'start-up'));

    if (startUp === undefined && !unmeasured.has(file)) {
      unmeasured.add(file);
      log.warn(
        `The dry run left no readable start-up time for "${file}", so its mutant runs count its start-up once per ` +
          "covering test, as Stryker's own timeout does.",
      );
    }

    return startUp;
  };

  return {
    record(file, startUp) {
      store.write(file, 'start-up', JSON.stringify(startUp));
    },

    deadline(files, testFilter, timeout) {
      return lzDeadlineMs(
        timeout,
        timeoutFactor,
        files.map((file) => {
          const startUp = read(file);
          // Stryker runs every test of a file for a static mutant, or without coverage, and then sums the time of
          // every test of the dry run.
          const wholeFile = testFilter === undefined || testFilter.includes(file);

          return {
            covering: wholeFile ? (startUp?.tests ?? 0) : testFilter.filter((id) => within(id, file)).length,
            startUpMs: startUp?.startUpMs ?? 0,
          };
        }),
      );
    },
  };
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function storedStartUp(content: string | undefined): LzStartUp | undefined {
  if (content === undefined) {
    return undefined;
  }

  try {
    const stored: unknown = JSON.parse(content);

    if (isObject(stored)) {
      const { startUpMs, tests } = stored;

      if (isCount(startUpMs) && isCount(tests)) {
        return { startUpMs, tests };
      }
    }
  } catch {
    // Not JSON.
  }

  return undefined;
}

/** A test file of a mutant run: its covering tests and its start-up time from the dry run. */
export interface LzDeadlineFile {
  readonly covering: number;
  readonly startUpMs: number;
}

/**
 * Stryker's `timeout` less `timeoutFactor` times each file's start-up for every covering test after the file's first:
 * Stryker's timeout counts a file's start-up once per covering test, as each test's time holds it, and the run starts
 * the file once. A millisecond of each start-up stays counted, so that what is left never falls below the tests' time
 * and each start-up once, however Stryker rounded each test's time.
 */
export function lzDeadlineMs(timeout: number, timeoutFactor: number, files: readonly LzDeadlineFile[]): number {
  const extraStartUpMs = files.reduce(
    (sum, { covering, startUpMs }) => sum + Math.max(0, covering - 1) * Math.max(0, startUpMs - 1),
    0,
  );

  return timeout - timeoutFactor * extraStartUpMs;
}
