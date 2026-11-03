import type { Logger } from '@stryker-mutator/api/logging';

import type { LzDryRunStore } from './dry-run-store.ts';
import type { ProcessRecord } from './record.ts';

/**
 * The memory each process of a test file may hold. A test that a mutant fails can need more than it did passing, as
 * Node.js's assertion diff grows with the square of the lines it compares (nodejs/node#62792).
 */
export interface MemoryLimits {
  forDryRun(): number | undefined;
  record(file: string, records: readonly ProcessRecord[]): void;
  forMutantRun(file: string): number;
}

/**
 * Without lzNodeTest.maxMemoryMB, a mutant run gives a file its dry-run peak times 1.5 plus 1024 MB, as Stryker scales
 * and pads its timeouts.
 */
export function memoryLimits(maxMemoryMB: number | undefined, store: LzDryRunStore, log: Logger): MemoryLimits {
  if (maxMemoryMB === undefined) {
    return dryRunPeaks(store, log);
  }

  return { forDryRun: () => maxMemoryMB, record: () => undefined, forMutantRun: () => maxMemoryMB };
}

function dryRunPeaks(store: LzDryRunStore, log: Logger): MemoryLimits {
  const unmeasured = new Set<string>();

  return {
    forDryRun: () => undefined,

    record(file, records) {
      const peakMB = Math.max(0, ...records.map((record) => record.peakMemoryMB ?? 0));
      store.write(file, 'peak', String(peakMB));
    },

    /** A file without a dry-run peak, as when Stryker's --testFiles names fewer files, gets the floor with a warning. */
    forMutantRun(file) {
      const peakMB = storedPeak(store.read(file, 'peak'));
      const limitMB = Math.round((peakMB ?? 0) * 1.5 + 1024);

      if (peakMB === undefined && !unmeasured.has(file)) {
        unmeasured.add(file);
        log.warn(
          `The dry run left no readable memory peak for "${file}", ` +
            `so each process of its mutant runs may hold ${limitMB} MB. ` +
            'Set lzNodeTest.maxMemoryMB to choose the limit.',
        );
      }

      return limitMB;
    },
  };
}

function storedPeak(stored: string | undefined): number | undefined {
  return stored !== undefined && /^\d+$/.test(stored) ? Number(stored) : undefined;
}
