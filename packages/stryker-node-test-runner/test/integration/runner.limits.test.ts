import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DryRunStatus, MutantRunStatus, TestStatus } from '@stryker-mutator/api/test-runner';

import { lzTestFor } from '@layzee/node-test-extensions';
import { envNames } from '../../src/record.ts';
import {
  complete,
  dryRun,
  fixture,
  grows,
  initRunner,
  logger,
  mutantRunOptions,
  project,
  settle,
  shareCompileCache,
  withoutDuration,
} from '../runner.fixtures.ts';

shareCompileCache();

describe('LzNodeTestTestRunner limits', () => {
  const loop = (hits: number) =>
    [
      'const ns = globalThis.__stryker__;',
      `for (let i = 0; i < ${hits}; i++) {`,
      "  if (ns.hitCount !== undefined && ++ns.hitCount > ns.hitLimit) throw new Error('Hit limit reached');",
      '}',
    ].join(' ');

  it('times out a mutant run that exceeds the hit limit', async (t) => {
    project(t, { 'a.test.mjs': fixture(`it('loops', () => { ${loop(11)} });`) });
    const runner = await initRunner(['*.test.mjs']);

    assert.deepEqual(await settle(runner.mutantRun(mutantRunOptions({ hitLimit: 10, disableBail: true }))), {
      status: MutantRunStatus.Timeout,
      reason: 'Hit limit reached (11/10)',
    });
    assert.deepEqual(withoutDuration(await settle(runner.mutantRun(mutantRunOptions({ hitLimit: 11 })))), {
      status: MutantRunStatus.Survived,
      nrOfTests: 1,
    });
  });

  it('times out a mutant run whose test file exceeds the hit limit while it loads, which fails it outside any test', async (t) => {
    project(t, { 'a.test.mjs': fixture(loop(11), "it('passes', () => {});") });
    const runner = await initRunner(['a.test.mjs']);

    assert.deepEqual(await settle(runner.mutantRun(mutantRunOptions({ hitLimit: 10 }))), {
      status: MutantRunStatus.Timeout,
      reason: 'Hit limit reached (11/10)',
    });
  });

  it('times out when a process a test starts exceeds the hit limit, counting each process apart', async (t) => {
    const spawnLoop = (hits: number) => `spawnSync(process.execPath, ['-e', ${JSON.stringify(loop(hits))}]);`;
    project(t, {
      'a.test.mjs': fixture(`it('spawns a loop', () => { ${spawnLoop(11)} });`),
      'b.test.mjs': fixture(`it('spawns two loops', () => { ${spawnLoop(6)} ${spawnLoop(6)} });`),
    });
    const options = mutantRunOptions({ hitLimit: 10 });

    assert.deepEqual(await settle((await initRunner(['a.test.mjs'])).mutantRun(options)), {
      status: MutantRunStatus.Timeout,
      reason: 'Hit limit reached (11/10)',
    });
    assert.deepEqual(withoutDuration(await settle((await initRunner(['b.test.mjs'])).mutantRun(options))), {
      status: MutantRunStatus.Survived,
      nrOfTests: 1,
    });
  });

  it('times out a mutant run whose process holds more memory than maxMemoryMB while a test blocks it', async (t) => {
    project(t, {
      'a.test.mjs': fixture(`it('grows', () => { ${grows} });`),
    });
    const runner = await initRunner(['a.test.mjs'], { maxMemoryMB: 200 });

    const result = await settle(runner.mutantRun(mutantRunOptions()), 10_000);

    assert.strictEqual(result.status, MutantRunStatus.Timeout, `expected a timeout, got ${JSON.stringify(result)}`);
    assert.match(result.reason ?? '', /^Memory limit reached \(\d+\/200 MB\)$/);
  });

  it("limits each mutant run's processes to their file's dry-run peak, times 1.5, plus 1024 MB, in every runner", async (t) => {
    const limit = `process.env.${envNames.memoryLimit}`;
    project(t, {
      'a.test.mjs': fixture(`it('fails with its memory limit', () => { if (${limit}) throw new Error(${limit}); });`),
    });
    const dryRunner = await initRunner(['a.test.mjs']);

    assert.deepEqual(
      complete(await settle(dryRunner.dryRun(dryRun))).tests.map((test) => test.status),
      [TestStatus.Success],
    );
    const results = [];

    // Stryker runs the dry run in one worker and the mutants in all of them, each with a runner of its own.
    for (const runner of [await initRunner(['a.test.mjs']), dryRunner, await initRunner(['a.test.mjs'])]) {
      results.push(await settle(runner.mutantRun(mutantRunOptions())));
    }

    assert.deepEqual(
      results.map(({ status }) => status),
      [MutantRunStatus.Killed, MutantRunStatus.Killed, MutantRunStatus.Killed],
      JSON.stringify(results),
    );
    const limits = results.map((result) =>
      result.status === MutantRunStatus.Killed ? Number(result.failureMessage) : NaN,
    );

    const [first] = limits;
    assert.ok(first, String(limits));

    // A Node.js process that runs one empty test holds well under 500 MB.
    assert.ok(first > 1024, String(limits));
    assert.ok(first < 1024 + 1.5 * 500, String(limits));
    assert.deepEqual(limits, [first, first, first]);
  });
  lzTestFor<readonly [string, number | undefined, readonly [number, number], number]>([
    ['the 1024 MB floor, with a warning once,', undefined, [1024, 1024], 1],
    ['lzNodeTest.maxMemoryMB when set, without a warning,', 1500, [1500, 1500], 0],
  ])(
    'gives the processes of a file that the dry run did not run %s in every mutant run',
    async ([, maxMemoryMB, expected, warningCount], t) => {
      const limit = `process.env.${envNames.memoryLimit}`;
      const dir = project(t, {
        'a.test.mjs': fixture(`it('fails with its memory limit', () => { throw new Error(${limit}); });`),
      });
      const warnings: string[] = [];
      const runner = await initRunner(
        ['a.test.mjs'],
        { ...(maxMemoryMB !== undefined && { maxMemoryMB }) },
        { log: logger({ warnings }) },
      );
      const results = [];

      for (let run = 0; run < 2; run++) {
        results.push(await settle(runner.mutantRun(mutantRunOptions())));
      }

      assert.deepEqual(
        results.map(({ status }) => status),
        [MutantRunStatus.Killed, MutantRunStatus.Killed],
        JSON.stringify(results),
      );
      assert.deepEqual(
        results.map((result) => (result.status === MutantRunStatus.Killed ? Number(result.failureMessage) : NaN)),
        expected,
      );
      // The dry run left no start-up times either, which the runner warns about apart.
      const memoryWarnings = warnings.filter((warning) => warning.includes('memory peak'));

      assert.equal(memoryWarnings.length, warningCount);
      assert.ok(
        memoryWarnings.every((warning) => warning.includes(`"${dir}`)),
        String(warnings),
      );
    },
  );

  it('ends a dry run under lzNodeTest.maxMemoryMB as an error that names the first file, in order, that held more', async (t) => {
    const waits = fixture("it('waits', async () => { await new Promise((resolve) => setTimeout(resolve, 1_000)); });");
    const dir = project(t, { 'a.test.mjs': waits, 'b.test.mjs': waits });
    const runner = await initRunner(['*.test.mjs'], { maxMemoryMB: 10 }, { concurrency: 2 });

    const result = await settle(runner.dryRun(dryRun));

    assert.strictEqual(result.status, DryRunStatus.Error, `expected an error, got ${JSON.stringify(result)}`);
    const rssMB = Number(/ held (\d+) MB /.exec(result.errorMessage)?.[1]);
    assert.ok(rssMB > 10, result.errorMessage);
    assert.equal(
      result.errorMessage,
      `A process of "${join(dir, 'a.test.mjs')}" held ${rssMB} MB in the dry run, more than lzNodeTest.maxMemoryMB ` +
        "(10 MB), so its mutant runs would time out. Raise lzNodeTest.maxMemoryMB, or leave it out to derive each file's " +
        'limit from the dry run.',
    );
  });
});
