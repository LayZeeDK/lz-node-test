import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { lzTestFor } from '@layzee/node-test-extensions';
import { logger } from '../runner.fixtures.ts';
import { lzDryRunStore } from '../../src/dry-run-store.ts';
import { lzOutsideMs, type RecordedTest } from '../../src/record.ts';
import { lzToTestResults } from '../../src/runner.ts';
import { lzDeadlineMs, lzStartUpOf, lzStartUps } from '../../src/start-up.ts';

const passed = (id: string, timeSpentMs: number): RecordedTest => ({ id, status: 'passed', timeSpentMs });

function setup(t: TestContext) {
  const parent = mkdtempSync(join(tmpdir(), 'start-ups-'));
  t.after(() => {
    rmSync(parent, { recursive: true, force: true });
  });
  const dir = join(parent, 'dry-run');
  const store = lzDryRunStore(dir);
  store.start();
  const warnings: string[] = [];
  // Each call is another runner, as in another Stryker worker.
  const runner = () => lzStartUps(store, 1.5, logger({ warnings }));

  return { dir, warnings, runner };
}

describe('lzStartUps', () => {
  it("takes off the start-ups of the covering tests after each file's first, as another runner recorded them in the dry run", (t) => {
    const { warnings, runner } = setup(t);
    const dryRun = runner();
    dryRun.record('a.test.ts', { startUpMs: 401, tests: 5 });
    dryRun.record('b.test.ts', { startUpMs: 201, tests: 2 });

    const filter = ['a.test.ts > x', 'a.test.ts > x > y', 'a.test.ts > z', 'b.test.ts > w'];

    assert.equal(runner().deadline(['a.test.ts', 'b.test.ts'], filter, 10_000), 10_000 - 1.5 * 2 * 400);
    assert.deepEqual(warnings, []);
  });

  lzTestFor<readonly [string, readonly string[] | undefined]>([
    ['no test filter', undefined],
    ["a test filter of whole files, as Stryker's --testFiles gives a static mutant", ['a.test.ts', 'b.test.ts']],
  ])("counts every test of a file's dry run as covering under %s", ([, filter], t) => {
    const { runner } = setup(t);
    const dryRun = runner();
    dryRun.record('a.test.ts', { startUpMs: 401, tests: 5 });
    dryRun.record('b.test.ts', { startUpMs: 201, tests: 2 });

    assert.equal(runner().deadline(['a.test.ts', 'b.test.ts'], filter, 10_000), 10_000 - 1.5 * (4 * 400 + 200));
  });

  it('takes a recorded start-up of 0 ms as a record, without warning', (t) => {
    const { warnings, runner } = setup(t);
    const dryRun = runner();
    dryRun.record('a.test.ts', { startUpMs: 0, tests: 3 });
    dryRun.record('b.test.ts', { startUpMs: 201, tests: 2 });

    assert.equal(runner().deadline(['a.test.ts', 'b.test.ts'], undefined, 10_000), 10_000 - 1.5 * 200);
    assert.deepEqual(warnings, []);
  });

  lzTestFor<readonly [string, string | undefined]>([
    ['no record', undefined],
    ['a record that is not JSON', '{"startUpMs":401,'],
    ['a record without the test count', '{"startUpMs":401}'],
    ['a record with a negative start-up', '{"startUpMs":-401,"tests":5}'],
    ['a record with a fractional test count', '{"startUpMs":401,"tests":2.5}'],
  ])("keeps Stryker's timeout for a file with %s, warning about it once", ([, stored], t) => {
    const { dir, warnings, runner } = setup(t);
    const dryRun = runner();
    dryRun.record('b.test.ts', { startUpMs: 201, tests: 2 });

    if (stored !== undefined) {
      dryRun.record('a.test.ts', { startUpMs: 0, tests: 0 });
      overwriteRecords(dir, 'a.test.ts', stored);
    }

    const mutantRuns = runner();
    const filter = ['a.test.ts > x', 'a.test.ts > z', 'b.test.ts > w', 'b.test.ts > v'];

    assert.deepEqual(
      [
        mutantRuns.deadline(['a.test.ts', 'b.test.ts'], filter, 10_000),
        mutantRuns.deadline(['a.test.ts'], filter, 10_000),
      ],
      [10_000 - 1.5 * 200, 10_000],
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /"a\.test\.ts"/);
  });
});

function overwriteRecords(dir: string, file: string, content: string): void {
  const name = `${createHash('sha256').update(file).digest('hex')}.start-up`;

  assert.ok(readdirSync(dir).includes(name), `expected a record for ${file}`);
  writeFileSync(join(dir, name), content);
}

describe('lzStartUpOf', () => {
  it("keeps a file's run time outside its outermost tests, in whole milliseconds, and how many tests it has", () => {
    const tests = [passed('a > x', 100), passed('a > x > y', 60), passed('a > z', 50)];

    assert.deepEqual(lzStartUpOf(tests, 560.9), { startUpMs: 410, tests: 3 });
  });

  it('keeps no start-up for a file whose outermost tests took longer than its run', () => {
    assert.deepEqual(lzStartUpOf([passed('a > x', 100), passed('a > z', 50)], 120), { startUpMs: 0, tests: 2 });
  });
});

describe('lzDeadlineMs', () => {
  it("keeps Stryker's timeout for a file with one covering test", () => {
    assert.equal(lzDeadlineMs(10_000, 1.5, [{ covering: 1, startUpMs: 400 }]), 10_000);
  });

  it("takes timeoutFactor times the start-up, less a millisecond, off Stryker's timeout for each covering test after a file's first", () => {
    assert.equal(lzDeadlineMs(10_000, 1.5, [{ covering: 3, startUpMs: 401 }]), 10_000 - 1.5 * 2 * 400);
  });

  it('adds up what each file of the run takes off', () => {
    const files = [
      { covering: 3, startUpMs: 401 },
      { covering: 1, startUpMs: 250 },
      { covering: 2, startUpMs: 101 },
    ];

    assert.equal(lzDeadlineMs(10_000, 2, files), 10_000 - 2 * (2 * 400 + 100));
  });

  it("gives each file at least its tests' time and its start-up once, or Stryker's own share where that is less", () => {
    // A linear congruential generator, so every run checks the same cases.
    let seed = 1;
    const random = () => {
      seed = (seed * 48_271) % 2_147_483_647;

      return seed / 2_147_483_647;
    };
    const timeoutFactor = 1.5;
    const otherMs = 5_000;
    const file = (name: string) => {
      const tests = Array.from({ length: 1 + Math.floor(random() * 40) }, (_, index) =>
        passed(`${name} > ${index}`, random() * 3),
      );
      const fileMs = tests.reduce((sum, test) => sum + test.timeSpentMs, 0) + random() * 900;
      const covering = tests.slice(0, 1 + Math.floor(random() * tests.length));
      const reported = lzToTestResults(name, tests, fileMs).slice(0, covering.length);

      return {
        startUp: lzStartUpOf(tests, fileMs),
        covering: covering.length,
        coveringMs: covering.reduce((sum, test) => sum + test.timeSpentMs, 0),
        exactStartUpMs: lzOutsideMs(tests, fileMs),
        summedMs: reported.reduce((sum, test) => sum + test.timeSpentMs, 0),
      };
    };

    const shortRuns = Array.from({ length: 2_000 }, (_, run) => {
      const files = [file('a'), file('b')];
      const timeout = timeoutFactor * files.reduce((sum, { summedMs }) => sum + summedMs, 0) + otherMs;
      // Stryker rounds each test's time, which can leave its own share of a file below the exact need.
      const once =
        timeoutFactor *
          files.reduce(
            (sum, { coveringMs, exactStartUpMs, summedMs }) => sum + Math.min(summedMs, coveringMs + exactStartUpMs),
            0,
          ) +
        otherMs;
      const deadline = lzDeadlineMs(
        timeout,
        timeoutFactor,
        files.map(({ covering, startUp }) => ({ covering, startUpMs: startUp.startUpMs })),
      );

      return deadline >= once
        ? []
        : [`run ${run}: ${deadline} ms < ${once} ms; ${JSON.stringify(files)}, timeout ${timeout}`];
    }).flat();

    assert.deepEqual(shortRuns, []);
  });

  it('never gives a deadline below 1 ms, as when records left by another run take off more than the timeout', () => {
    assert.equal(lzDeadlineMs(100, 1.5, [{ covering: 50, startUpMs: 401 }]), 1);
  });

  it("keeps Stryker's timeout for a file without tests, which Stryker's timeout has no time for", () => {
    assert.equal(lzDeadlineMs(10_000, 1.5, [{ covering: 0, startUpMs: 401 }]), 10_000);
  });

  lzTestFor<readonly [number]>([[0], [1]])(
    'takes nothing off for a file whose start-up is %d ms, below the millisecond kept for rounding',
    ([startUpMs]) => {
      assert.equal(lzDeadlineMs(10_000, 1.5, [{ covering: 3, startUpMs }]), 10_000);
    },
  );
});
