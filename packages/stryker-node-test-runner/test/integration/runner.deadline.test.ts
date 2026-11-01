import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { MutantRunStatus } from '@stryker-mutator/api/test-runner';

import { isRunning } from '../../src/dirs.ts';
import {
  complete,
  dryRun,
  fixture,
  initRunner,
  logger,
  mutantRunOptions,
  project,
  settle,
  shareCompileCache,
  withoutDuration,
} from '../runner.fixtures.ts';

shareCompileCache();

/**
 * Three tests in a file that takes 600 ms to load. With LZ_FIXTURE_HANG set, the first test starts a process that
 * writes its pid and runs on, and then waits forever.
 */
const slowStart = fixture(
  'await new Promise((resolve) => setTimeout(resolve, 600));',
  "const { spawn } = await import('node:child_process');",
  "it('hangs', async () => { if (process.env.LZ_FIXTURE_HANG) {",
  "  spawn(process.execPath, ['-e', 'require(\"node:fs\").writeFileSync(\"child.pid\", String(process.pid)); setInterval(() => {}, 1000);'], { stdio: 'ignore', windowsHide: true });",
  '  await new Promise(() => setInterval(() => {}, 1000));',
  '} });',
  "it('passes', () => {});",
  "it('passes too', () => {});",
);

function hang(t: TestContext): void {
  process.env['LZ_FIXTURE_HANG'] = '1';
  t.after(stopHanging);
}

function stopHanging(): void {
  delete process.env['LZ_FIXTURE_HANG'];
}

describe('LzStrykerNodeTestRunner deadline', () => {
  it("times out a mutant run once its tests' time and each file's start-up counted once have passed, before Stryker's timeout", async (t) => {
    const dir = project(t, { 'a.test.mjs': slowStart });
    const runner = await initRunner(['a.test.mjs']);
    const { tests } = complete(await settle(runner.dryRun(dryRun)));
    // As Stryker sizes it, with a timeoutMS of 500 to keep the test short.
    const timeout = 1.5 * tests.reduce((sum, test) => sum + test.timeSpentMs, 0) + 500;
    hang(t);

    const started = performance.now();
    const result = await settle(
      runner.mutantRun(mutantRunOptions({ timeout, testFilter: tests.map((test) => test.id) })),
    );
    const elapsed = performance.now() - started;

    assert.strictEqual(result.status, MutantRunStatus.Timeout, JSON.stringify(result));
    assert.equal(
      result.reason?.replace(/deadline of \d+ ms/, 'deadline of N ms'),
      "Passed the runner's deadline of N ms, which counts each test file's start-up once " +
        `(Stryker's timeout: ${Math.round(timeout)} ms)`,
    );
    assert.ok(elapsed < timeout, `${elapsed} ms of Stryker's ${timeout} ms`);
    assert.equal(isRunning(Number(readFileSync(join(dir, 'child.pid'), 'utf8'))), false);
  });

  it('ends a file process at once when the deadline passed before the file started', async (t) => {
    const dir = project(t, { 'a.test.mjs': slowStart });
    const runner = await initRunner(['a.test.mjs']);
    hang(t);

    const { records } = await settle(
      runner.runFile(join(dir, 'a.test.mjs'), { dryRun: false, disableBail: false }, undefined, AbortSignal.abort()),
      5_000,
    );

    assert.deepEqual(records, []);
  });

  it('runs the next mutant in the same runner after its deadline passed', async (t) => {
    project(t, { 'a.test.mjs': slowStart });
    const runner = await initRunner(['a.test.mjs']);
    const { tests } = complete(await settle(runner.dryRun(dryRun)));
    const options = mutantRunOptions({
      timeout: 1.5 * tests.reduce((sum, test) => sum + test.timeSpentMs, 0) + 500,
      testFilter: tests.map((test) => test.id),
    });
    hang(t);
    const timedOut = await settle(runner.mutantRun(options));
    stopHanging();

    assert.strictEqual(timedOut.status, MutantRunStatus.Timeout, JSON.stringify(timedOut));
    assert.deepEqual(withoutDuration(await settle(runner.mutantRun(options))), {
      status: MutantRunStatus.Survived,
      nrOfTests: 3,
    });
  });

  it('runs the mutants of a file the dry run did not run, warning once that it has no start-up time', async (t) => {
    const dir = project(t, { 'a.test.mjs': slowStart });
    const warnings: string[] = [];
    const runner = await initRunner(['a.test.mjs'], {}, { log: logger({ warnings }) });
    const options = mutantRunOptions({
      testFilter: ['hangs', 'passes', 'passes too'].map((name) => `${join(dir, 'a.test.mjs')} > ${name}`),
    });

    const results = [await settle(runner.mutantRun(options)), await settle(runner.mutantRun(options))];

    assert.deepEqual(results.map(withoutDuration), [
      { status: MutantRunStatus.Survived, nrOfTests: 3 },
      { status: MutantRunStatus.Survived, nrOfTests: 3 },
    ]);
    assert.deepEqual(
      warnings.filter((warning) => warning.includes('start-up')),
      [
        `The dry run left no readable start-up time for "${join(dir, 'a.test.mjs')}", so its mutant runs count its ` +
          "start-up once per covering test, as Stryker's own timeout does.",
      ],
    );
  });
});
