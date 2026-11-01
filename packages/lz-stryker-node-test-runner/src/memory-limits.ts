import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Logger } from '@stryker-mutator/api/logging';

import { lzDirPrefix, ownDir } from './dirs.ts';
import { envNames, type ProcessRecord } from './record.ts';

/**
 * Where the runners of one Stryker run keep the most memory a process of each test file held in the dry run, one file
 * per test file. Stryker runs the dry run in one worker and the mutants in all of them, each a process it forks and
 * may replace, so the directory is named after the process that owns the peaks (see `ownPeaks`).
 */
export function peakMemoryDir(ownerPid: number): string {
  return join(tmpdir(), `${lzDirPrefix('peaks', ownerPid)}dry-run`);
}

/**
 * The pid of the process that owns the dry-run peaks: the first process to load this module that inherited no owner.
 * Stryker imports every plugin in its own process before it forks a worker, and each worker inherits its environment,
 * so in a Stryker run the owner is Stryker's own process; a test that builds runners owns them itself. The owner
 * removes the directory when it exits. A killed owner leaves it to a later runner's `removeLeftDirs`.
 */
export function ownPeaks(): number {
  const inherited = process.env[envNames.peaksOwner];

  if (inherited !== undefined) {
    return Number(inherited);
  }

  process.env[envNames.peaksOwner] = String(process.pid);
  process.once('exit', () => {
    try {
      rmSync(peakMemoryDir(process.pid), { recursive: true });
    } catch {
      // Left for a later runner's removeLeftDirs.
    }
  });

  return process.pid;
}

/**
 * The memory each process of a test file may hold. A test that a mutant fails can need more than it did passing, as
 * Node.js's assertion diff grows with the square of the lines it compares (nodejs/node#62792).
 */
export interface MemoryLimits {
  startDryRun(): number | undefined;
  record(file: string, records: readonly ProcessRecord[]): void;
  forMutantRun(file: string): number;
}

/**
 * Without lzStrykerNodeTest.maxMemoryMB, a mutant run gives a file its dry-run peak times 1.5 plus 1024 MB, as Stryker scales
 * and pads its timeouts.
 */
export function memoryLimits(maxMemoryMB: number | undefined, dir: string, log: Logger): MemoryLimits {
  if (maxMemoryMB === undefined) {
    return dryRunPeaks(dir, log);
  }

  return { startDryRun: () => maxMemoryMB, record: () => undefined, forMutantRun: () => maxMemoryMB };
}

function dryRunPeaks(dir: string, log: Logger): MemoryLimits {
  const unmeasured = new Set<string>();
  const path = (file: string) => join(dir, createHash('sha256').update(file).digest('hex'));

  return {
    startDryRun(): undefined {
      ownDir(dir);
    },

    record(file, records) {
      const peakMB = Math.max(0, ...records.map((record) => record.peakMemoryMB ?? 0));
      writeFileSync(path(file), String(peakMB));
    },

    /** A file without a dry-run peak, as when Stryker's --testFiles names fewer files, gets the floor with a warning. */
    forMutantRun(file) {
      const peakMB = storedPeak(path(file));
      const limitMB = Math.round((peakMB ?? 0) * 1.5 + 1024);

      if (peakMB === undefined && !unmeasured.has(file)) {
        unmeasured.add(file);
        log.warn(
          `The dry run left no readable memory peak for "${file}", ` +
            `so each process of its mutant runs may hold ${limitMB} MB. ` +
            'Set lzStrykerNodeTest.maxMemoryMB to choose the limit.',
        );
      }

      return limitMB;
    },
  };
}

function storedPeak(path: string): number | undefined {
  try {
    const stored = readFileSync(path, 'utf8');

    return /^\d+$/.test(stored) ? Number(stored) : undefined;
  } catch {
    return undefined;
  }
}
