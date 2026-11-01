import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { lzTestFor } from '@layzee/lz-node-test';
import { logger } from '../runner.fixtures.ts';
import { lzDryRunStore } from '../../src/dry-run-store.ts';
import { memoryLimits } from '../../src/memory-limits.ts';

function setup(t: TestContext, maxMemoryMB?: number) {
  const parent = mkdtempSync(join(tmpdir(), 'memory-limits-'));
  t.after(() => {
    rmSync(parent, { recursive: true, force: true });
  });
  const dir = join(parent, 'dry-run');
  const warnings: string[] = [];
  const store = lzDryRunStore(dir);
  const limits = () => memoryLimits(maxMemoryMB, store, logger({ warnings }));

  return { dir, store, warnings, limits };
}

describe('memoryLimits', () => {
  it('runs the dry run and every mutant run under lzStrykerNodeTest.maxMemoryMB, and keeps no peaks', (t) => {
    const { dir, store, warnings, limits } = setup(t, 1500);
    const dryRun = limits();

    store.start();
    assert.equal(dryRun.forDryRun(), 1500);
    dryRun.record('a.test.ts', [{ tests: [], peakMemoryMB: 2000 }]);

    assert.deepEqual([dryRun.forMutantRun('a.test.ts'), limits().forMutantRun('b.test.ts')], [1500, 1500]);
    assert.deepEqual(readdirSync(dir), []);
    assert.deepEqual(warnings, []);
  });

  lzTestFor<readonly [readonly (number | undefined)[], number]>([
    [[370], 1579],
    [[101], 1176],
    [[50, 370, 100], 1579],
    [[undefined], 1024],
    [[], 1024],
  ])(
    'gives a file whose dry-run processes peaked at %j MB a limit of %d MB, also in another runner',
    ([peaks, limitMB], t) => {
      const { store, warnings, limits } = setup(t);
      const dryRun = limits();

      store.start();
      assert.equal(dryRun.forDryRun(), undefined);
      dryRun.record(
        'a.test.ts',
        peaks.map((peakMemoryMB) => ({ tests: [], ...(peakMemoryMB !== undefined && { peakMemoryMB }) })),
      );

      assert.deepEqual([dryRun.forMutantRun('a.test.ts'), limits().forMutantRun('a.test.ts')], [limitMB, limitMB]);
      assert.deepEqual(warnings, []);
    },
  );

  lzTestFor<readonly [string]>([[''], ['not a number'], ['12x'], ['x12']])(
    'gives a file whose stored peak reads %j 1024 MB, warning about it as about a missing peak',
    ([stored], t) => {
      const { dir, store, warnings, limits } = setup(t);
      const dryRun = limits();
      store.start();
      dryRun.record('a.test.ts', [{ tests: [], peakMemoryMB: 370 }]);

      for (const name of readdirSync(dir)) {
        writeFileSync(join(dir, name), stored);
      }

      assert.equal(limits().forMutantRun('a.test.ts'), 1024);
      assert.equal(warnings.length, 1);
    },
  );

  it('gives a file without a dry-run peak 1024 MB, warning about it once', (t) => {
    const { store, warnings, limits } = setup(t);
    store.start();
    const mutantRuns = limits();

    assert.deepEqual([mutantRuns.forMutantRun('a.test.ts'), mutantRuns.forMutantRun('a.test.ts')], [1024, 1024]);
    assert.deepEqual(warnings, [
      'The dry run left no readable memory peak for "a.test.ts", ' +
        'so each process of its mutant runs may hold 1024 MB. Set lzStrykerNodeTest.maxMemoryMB to choose the limit.',
    ]);
  });
});
