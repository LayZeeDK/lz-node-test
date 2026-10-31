import type { MutantCoverage } from '@stryker-mutator/api/core';

import { isNumber, isObject } from './guards.ts';
import type { ProcessRecord } from './record.ts';

export type LzEndingSignal = 'SIGTERM' | 'SIGINT' | 'SIGHUP';

/** The signals that end a process that does not listen for them; `kill()` sends SIGTERM by default. */
export const lzEndingSignals: readonly LzEndingSignal[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

export interface LzProcessSignals {
  readonly on: (signal: LzEndingSignal, listener: () => void) => void;
  readonly off: (signal: LzEndingSignal, listener: () => void) => void;
  readonly listenerCount: (signal: LzEndingSignal) => number;
  /**
   * The emitters through which signal-exit counts its listeners, whatever is in their place: version 4's on
   * `globalThis[Symbol.for('signal-exit emitter')]`, version 3's on `process.__signal_exit_emitter__`.
   */
  readonly signalExitEmitters: () => readonly unknown[];
  /** Sends the process `signal` again. */
  readonly raise: (signal: LzEndingSignal) => void;
}

/** What the hook takes from the process to write its record whenever the process ends. */
export interface LzRecordDependencies {
  readonly onExit: (listener: () => void) => void;
  readonly offExit: (listener: () => void) => void;
  /** Registers a `beforeExit` listener, which a process that ends by itself calls and `process.exit()` skips. */
  readonly onBeforeExit: (listener: () => void) => void;
  /**
   * Writes the record to `lzTempRecordPath(path)` and renames that over `path`, so that a reader finds the record whole,
   * and a kill during the write leaves the one before.
   */
  readonly writeRecord: (path: string, record: ProcessRecord) => void;
  /** Calls `callback` every `ms` without keeping the process alive. */
  readonly every: (callback: () => void, ms: number) => void;
  /**
   * The process's signals; undefined on Windows, where every kill is `TerminateProcess`, which runs no listener, and a
   * SIGINT listener would keep Ctrl+C from ending the process.
   */
  readonly signals: LzProcessSignals | undefined;
}

/**
 * How often a process the tests started writes its record in the dry run. One write of a 500 KiB coverage map takes
 * about 10 ms, and counting its hits to see whether it changed about 2 ms.
 */
const recordIntervalMs = 250;

/** How many hits `coverage` counts; it only grows, as instrumented code adds mutants and counts up. */
export function lzHits(coverage: MutantCoverage | undefined): number {
  if (coverage === undefined) {
    return 0;
  }

  return [coverage.static, ...Object.values(coverage.perTest)]
    .flatMap((hits) => Object.values(hits))
    .reduce((sum, count) => sum + count, 0);
}

/**
 * Writes the record of the process at `path` however the process ends: on exit, behind the exit listeners of the tests
 * when it ends by itself, and, for a process the tests started, on a signal that would end it and in the dry run while
 * it runs. `record` is told whether the process ends by itself.
 */
export function lzPersistRecord(
  deps: LzRecordDependencies,
  path: string,
  record: (natural: boolean) => ProcessRecord,
  { main, dryRun }: { readonly main: boolean; readonly dryRun: boolean },
): void {
  let natural = false;
  const write = () => {
    deps.writeRecord(path, record(natural));
  };

  // Node.js runs no exit listener that is added while the process exits, so the record goes behind the exit listeners
  // of the tests here, where a process that ends by itself still runs code. process.exit() skips `beforeExit`.
  deps.onBeforeExit(() => {
    natural = true;
    deps.offExit(write);
    deps.onExit(write);
  });
  deps.onExit(write);

  // Nothing signals the test file's own process while it runs: the runner reads its record once it has exited.
  if (deps.signals && !main) {
    writeOnEndingSignals(deps.signals, write);
  }

  // A process the tests started can end without its exit listeners, as `worker.terminate()` and every kill on Windows
  // end it, so in the one run that reads coverage its record follows the coverage while it runs. The test file's own
  // process does not need it: the runner reads its record only once it has exited.
  if (dryRun && !main) {
    writeOnNewHits(
      deps.every,
      () => record(natural),
      (current) => deps.writeRecord(path, current),
    );
  }
}

/** Calls `write` every `recordIntervalMs` once the record counts more hits than at its last call. */
function writeOnNewHits(
  every: LzRecordDependencies['every'],
  record: () => ProcessRecord,
  write: (record: ProcessRecord) => void,
): void {
  let writtenHits = 0;
  every(() => {
    const current = record();
    const hits = lzHits(current.mutantCoverage);

    if (hits === writtenHits) {
      return;
    }

    writtenHits = hits;

    try {
      write(current);
    } catch {
      // The run that reads the record can be over, with its directory removed, while the process still runs.
    }
  }, recordIntervalMs);
}

/** How many listeners signal-exit has for each signal, which leave how the process ends to any other listener. */
function signalExitListeners(signals: LzProcessSignals): number {
  return signals
    .signalExitEmitters()
    .reduce<number>(
      (sum, emitter) => sum + (isObject(emitter) && isNumber(emitter['count']) ? emitter['count'] : 0),
      0,
    );
}

/** The listener the hook adds for each signal, which `listenerCount` counts with the others. */
const ownListener = 1;

/**
 * Writes the record when a signal would end the process, which runs no exit listener then. When no other listener
 * decides how the process ends, the hook stops listening and raises the signal again, so the process ends by it as it
 * would without the hook, as signal-exit does.
 */
function writeOnEndingSignals(signals: LzProcessSignals, write: () => void): void {
  const listeners = lzEndingSignals.map((signal) => ({
    signal,
    listener: () => {
      try {
        write();
      } catch {
        // The process still ends by the signal: a process that swallows uncaught errors would otherwise outlive it.
      }

      const othersDecide = signals.listenerCount(signal) - ownListener > signalExitListeners(signals);

      if (othersDecide) {
        return;
      }

      listeners.forEach((entry) => signals.off(entry.signal, entry.listener));
      signals.raise(signal);
    },
  }));
  listeners.forEach(({ signal, listener }) => signals.on(signal, listener));
}
