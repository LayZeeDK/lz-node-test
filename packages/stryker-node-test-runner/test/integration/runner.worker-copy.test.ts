import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { DryRunStatus, MutantRunStatus } from '@stryker-mutator/api/test-runner';

import { lzDirPrefix } from '../../src/dirs.ts';
import {
  activeMutant,
  complete,
  dryRun,
  fixture,
  initRunner,
  logger,
  mutantRunOptions,
  noProcess,
  passed,
  passing,
  project,
  settle,
  shareCompileCache,
  summary,
} from '../runner.fixtures.ts';

shareCompileCache();

describe('LzNodeTestTestRunner experimentalWorkerCopy', () => {
  it("runs the test files in the worker's copy of the sandbox and names their tests by the sandbox's files", async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { writeFileSync } from 'node:fs';",
        "it('writes', () => { cover('f-write'); writeFileSync('written.txt', ''); });",
      ),
    });
    const file = join(dir, 'a.test.mjs');
    const runner = await initRunner(['*.test.mjs'], { experimentalWorkerCopy: true });

    const { tests, mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));
    await runner.dispose();

    assert.equal(existsSync(join(dir, 'written.txt')), false);
    assert.deepEqual(summary(tests), [passed(`${file} > writes`)]);
    assert.equal(tests[0]?.fileName, file);
    assert.equal(mutantCoverage?.perTest[`${file} > writes`]?.['f-write'], 1);
  });

  it("runs the tests that Stryker's filter names by the sandbox's files and names the killing ones the same", async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "it('other', () => { throw new Error('ran outside the filter'); });",
        `it('selected', () => { assert.equal(process.env.${activeMutant} ?? globalThis.__stryker__?.activeMutant, undefined); });`,
      ),
    });
    const selected = `${join(dir, 'a.test.mjs')} > selected`;
    const runner = await initRunner(['*.test.mjs'], { experimentalWorkerCopy: true });

    const result = await settle(runner.mutantRun(mutantRunOptions({ testFilter: [selected] })));
    await runner.dispose();

    assert.equal(result.status, MutantRunStatus.Killed, JSON.stringify(result));
    assert.deepEqual(result.killedBy, [selected]);
  });

  it("runs a filtered test whose name holds the working folder, which is each worker's own copy", async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        `it(\`kills in \${process.cwd()}\`, () => { assert.equal(process.env.${activeMutant} ?? globalThis.__stryker__?.activeMutant, undefined); });`,
      ),
    });
    const selected = `${join(dir, 'a.test.mjs')} > kills in ${dir}`;
    const runner = await initRunner(['*.test.mjs'], { experimentalWorkerCopy: true });

    const result = await settle(runner.mutantRun(mutantRunOptions({ testFilter: [selected] })));
    await runner.dispose();

    assert.equal(result.status, MutantRunStatus.Killed, JSON.stringify(result));
    assert.deepEqual(result.killedBy, [selected]);
  });

  it("names the sandbox's file in the command that reproduces a failed test file, as the copy is gone by then", async (t) => {
    const dir = project(t, { 'a.test.mjs': "throw new Error('fails to load');" });
    const runner = await initRunner(['*.test.mjs'], { experimentalWorkerCopy: true });

    const result = await settle(runner.dryRun(dryRun));
    await runner.dispose();

    assert.equal(result.status, DryRunStatus.Error, JSON.stringify(result));
    const reproduce = result.errorMessage.split('\n').find((line) => line.startsWith('To reproduce'));
    assert.ok(reproduce, result.errorMessage);
    assert.ok(reproduce.includes(`"${join(dir, 'a.test.mjs')}"\` in ${dir}`), reproduce);
    assert.doesNotMatch(reproduce, /lz-node-test-copy-/);
  });

  it('refuses to copy the sandbox under inPlace, where the sandbox is the project itself', async (t) => {
    project(t, { 'a.test.mjs': passing });

    await assert.rejects(
      initRunner(['*.test.mjs'], { experimentalWorkerCopy: true }, { inPlace: true }),
      /experimentalWorkerCopy cannot run with inPlace/,
    );
  });

  it('removes its copy when it is disposed', async (t) => {
    const dir = project(t, { 'a.test.mjs': passing });
    const copies = () => readdirSync(dirname(dir)).filter((name) => name.startsWith(lzDirPrefix('copy', process.pid)));
    const before = copies();
    const runner = await initRunner(['*.test.mjs'], { experimentalWorkerCopy: true });
    const made = copies().filter((name) => !before.includes(name));

    await runner.dispose();

    assert.deepEqual(copies(), before);
    assert.equal(made.length, 1);
  });

  it('logs where it copied the sandbox and how long that took', async (t) => {
    project(t, { 'a.test.mjs': passing });
    const debug: string[] = [];
    const started = performance.now();
    const runner = await initRunner(['*.test.mjs'], { experimentalWorkerCopy: true }, { log: logger({ debug }) });
    const initMs = performance.now() - started;

    await runner.dispose();

    const copiedMs = Number(/ in (\d+) ms \(experimentalWorkerCopy\)/.exec(debug.join('\n'))?.[1]);
    assert.match(debug.join('\n'), /Copied the sandbox to .*lz-node-test-copy-\d+-\S+ in \d+ ms/);
    assert.ok(copiedMs <= Math.ceil(initMs), `copied in ${copiedMs} ms, init took ${initMs} ms`);
  });

  it('gives a runner that starts after another in the same process a fresh copy of the sandbox', async (t) => {
    const dir = project(t, { 'a.test.mjs': fixture("it('first', () => {});") });
    const file = join(dir, 'a.test.mjs');
    const copies = () => readdirSync(dirname(dir)).filter((name) => name.startsWith(lzDirPrefix('copy', process.pid)));
    const before = copies();
    const first = await initRunner(['*.test.mjs'], { experimentalWorkerCopy: true });
    await first.dispose();
    writeFileSync(file, fixture("it('second', () => {});"));

    const second = await initRunner(['*.test.mjs'], { experimentalWorkerCopy: true });
    const { tests } = complete(await settle(second.dryRun(dryRun)));
    await second.dispose();

    assert.deepEqual(summary(tests), [passed(`${file} > second`)]);
    assert.deepEqual(copies(), before);
  });

  it('removes the copy that a killed runner left beside the sandbox, but not what its links point at', async (t) => {
    const dir = project(
      t,
      { [join('sandbox', 'a.test.mjs')]: passing, [join('kept', 'file.txt')]: '' },
      { cwd: 'sandbox' },
    );
    const left = join(dir, `${lzDirPrefix('copy', noProcess)}left`);
    mkdirSync(left);
    symlinkSync(join(dir, 'kept'), join(left, 'node_modules'), 'junction');

    const runner = await initRunner(['*.test.mjs'], { experimentalWorkerCopy: true });
    await runner.dispose();

    assert.equal(existsSync(left), false);
    assert.equal(existsSync(join(dir, 'kept', 'file.txt')), true);
  });
});
