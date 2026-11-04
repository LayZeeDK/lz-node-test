import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import timers from 'node:timers/promises';

import { MutantRunStatus } from '@stryker-mutator/api/test-runner';

import { isRunning } from '../../src/dirs.ts';
import {
  complete,
  dryRun,
  fixture,
  initRunner,
  logger,
  mutantRunOptions,
  passing,
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

/**
 * One test that writes its process's pid and leaves a detached process for 3 s that holds stderr open and works in the
 * run's temporary directory. The file's process exits by itself soon after its test, but the runner is not done with
 * the file: on POSIX it waits up to 1500 ms more for stderr to close, and on Windows removing the run directory waits
 * up to 2000 ms for the process to end.
 */
const lateClose = fixture(
  "const { spawn } = await import('node:child_process');",
  "const { writeFileSync } = await import('node:fs');",
  "const { tmpdir } = await import('node:os');",
  "it('passes', () => {",
  "  spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { cwd: tmpdir(), detached: true, stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true }).unref();",
  "  writeFileSync('file.pid', String(process.pid));",
  '});',
);

/** With LZ_FIXTURE_PENDING set, its test waits on nothing that could settle it: `callback` or `promise`. */
const pending = fixture(
  "it('waits', (t, done) => {",
  "  if (process.env.LZ_FIXTURE_PENDING === 'promise') { new Promise(() => {}).then(done); }",
  "  else if (process.env.LZ_FIXTURE_PENDING !== 'callback') { done(); }",
  '});',
  "it('passes', () => {});",
);

/**
 * A test that waits 100 ms on an unref'd timer, which Node.js 24 waits for and Node.js 22 cancels, then one that waits
 * 600 ms on a ref'd timer.
 */
const unrefWait = fixture(
  "it('waits on an unref timer', async () => { await new Promise((resolve) => setTimeout(resolve, 100).unref()); });",
  "it('waits on a timer', async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });",
);

const nodeMajor = Number(process.versions.node.split('.')[0]);

/** Resolves once the process whose pid `path` holds has exited. */
async function processExit(path: string): Promise<void> {
  while (!existsSync(path) || isRunning(Number(readFileSync(path, 'utf8')))) {
    await timers.setTimeout(20);
  }
}

function hang(t: TestContext): void {
  process.env['LZ_FIXTURE_HANG'] = '1';
  t.after(stopHanging);
}

function stopHanging(): void {
  delete process.env['LZ_FIXTURE_HANG'];
}

describe('LzNodeTestTestRunner deadline', () => {
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

  it('reports the result of a mutant run whose deadline passed without ending any file process', async (t) => {
    const dir = project(t, { 'a.test.mjs': passing });
    const runner = await initRunner(['a.test.mjs']);
    const runFile = runner.runFile.bind(runner);
    // Runs the file without the deadline, which is 1 ms and passes while the file runs.
    runner.runFile = (file, run, memoryLimitMB) => runFile(file, run, memoryLimitMB);
    const options = mutantRunOptions({ timeout: 1, testFilter: [`${join(dir, 'a.test.mjs')} > passes`] });

    assert.deepEqual(withoutDuration(await settle(runner.mutantRun(options))), {
      status: MutantRunStatus.Survived,
      nrOfTests: 1,
    });
  });

  it('ends no file process that has exited when the deadline passes while the runner settles it', async (t) => {
    const dir = project(t, { 'a.test.mjs': lateClose });
    const runner = await initRunner(['a.test.mjs']);
    const deadline = new AbortController();
    const running = runner.runFile(
      join(dir, 'a.test.mjs'),
      { dryRun: false, disableBail: false },
      undefined,
      deadline.signal,
    );

    await processExit(join(dir, 'file.pid'));
    // The runner learns of the exit a moment later, and settles the file for 1500 ms or more.
    await timers.setTimeout(300);
    deadline.abort();
    const fileRun = await settle(running);

    assert.equal(fileRun.killedByDeadline, undefined);
    assert.equal(fileRun.exitCode, 0);
  });

  it("leaves no listener on a deadline for a file whose process ended, so one run's deadline does not collect them", async (t) => {
    const dir = project(t, { 'a.test.mjs': passing });
    const runner = await initRunner(['a.test.mjs']);
    const deadline = new AbortController();

    await settle(
      runner.runFile(join(dir, 'a.test.mjs'), { dryRun: false, disableBail: false }, undefined, deadline.signal),
    );

    assert.deepEqual(getEventListeners(deadline.signal, 'abort'), []);
  });

  it('ends a file process at once when the deadline passed before the file started', async (t) => {
    const dir = project(t, { 'a.test.mjs': slowStart });
    const runner = await initRunner(['a.test.mjs']);
    hang(t);

    const { records, killedByDeadline } = await settle(
      runner.runFile(join(dir, 'a.test.mjs'), { dryRun: false, disableBail: false }, undefined, AbortSignal.abort()),
      5_000,
    );

    assert.deepEqual(records, []);
    assert.equal(killedByDeadline, true);
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

  for (const kind of ['callback', 'promise']) {
    it(`times out a mutant run Stryker's timeoutMS after a ${kind} test is left pending with nothing to settle it`, async (t) => {
      project(t, { 'a.test.mjs': pending });
      const runner = await initRunner(['a.test.mjs'], undefined, { timeoutMS: 300 });
      const { tests } = complete(await settle(runner.dryRun(dryRun)));
      process.env['LZ_FIXTURE_PENDING'] = kind;
      t.after(() => {
        delete process.env['LZ_FIXTURE_PENDING'];
      });

      const started = performance.now();
      const result = await settle(runner.mutantRun(mutantRunOptions({ testFilter: tests.map((test) => test.id) })));
      const elapsed = performance.now() - started;

      // Node.js 22 cancels a pending test once the event loop is empty; Node.js 24 waits for it.
      const expected =
        nodeMajor >= 24
          ? {
              status: MutantRunStatus.Timeout,
              reason: "A test was still pending 300 ms after its file's event loop emptied (Stryker's timeoutMS)",
            }
          : { status: MutantRunStatus.Killed, reason: undefined };

      assert.deepEqual(
        { status: result.status, reason: result.status === MutantRunStatus.Timeout ? result.reason : undefined },
        expected,
      );
      assert.ok(elapsed < 5000, `${elapsed} ms`);
    });
  }

  it("keeps the results of a test that an unref'd timer settles within Stryker's timeoutMS and of the tests after it", async (t) => {
    project(t, { 'a.test.mjs': unrefWait });
    const runner = await initRunner(['a.test.mjs'], undefined, { timeoutMS: 300 });
    const { tests } = complete(await settle(runner.dryRun(dryRun)));

    const result = await settle(runner.mutantRun(mutantRunOptions({ testFilter: tests.map((test) => test.id) })));

    assert.strictEqual(result.status, nodeMajor >= 24 ? MutantRunStatus.Survived : MutantRunStatus.Killed);
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
