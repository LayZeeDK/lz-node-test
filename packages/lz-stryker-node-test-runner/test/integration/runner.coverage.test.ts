import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { DryRunOptions } from '@stryker-mutator/api/test-runner';

import { envNames } from '../../src/record.ts';
import {
  complete,
  cover,
  dryRun,
  failed,
  fixture,
  fixtureCoverage,
  initRunner,
  passed,
  project,
  settle,
  shareCompileCache,
  summary,
} from '../runner.fixtures.ts';

shareCompileCache();

describe('LzStrykerNodeTestRunner coverage', () => {
  it('reports the results and coverage of every test, including coverage of the processes a test starts', async (t) => {
    const child = `${cover} cover('f-shared'); cover('f-child');`;
    const dir = project(t, {
      'a.test.mjs': fixture(
        "cover('f-static');",
        "describe('suite', () => {",
        "  it('passes', () => { cover('f-pass'); });",
        "  it('fails', () => { cover('f-fail'); throw new Error('one is not two'); });",
        '});',
        "it('spawns', () => {",
        "  cover('f-shared');",
        `  const child = spawnSync(process.execPath, ['-e', ${JSON.stringify(child)}]);`,
        '  assert.equal(child.status, 0, String(child.stderr));',
        '});',
      ),
    });
    const file = join(dir, 'a.test.mjs');
    const runner = await initRunner(['*.test.mjs']);

    const { tests, mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(summary(tests), [
      passed(`${file} > suite > passes`),
      failed(`${file} > suite > fails`, 'one is not two'),
      passed(`${file} > spawns`),
    ]);
    assert.deepEqual(
      tests.map((test) => test.name),
      ['suite > passes', 'suite > fails', 'spawns'],
    );
    assert.ok(tests.every((test) => test.fileName === file && test.timeSpentMs >= 0));
    assert.equal(mutantCoverage?.static['f-static'], 1);
    assert.equal(mutantCoverage?.perTest[`${file} > suite > passes`]?.['f-pass'], 1);
    assert.equal(mutantCoverage?.perTest[`${file} > suite > fails`]?.['f-fail'], 1);
    assert.equal(mutantCoverage?.perTest[`${file} > spawns`]?.['f-shared'], 2);
    assert.equal(mutantCoverage?.perTest[`${file} > spawns`]?.['f-child'], 1);
  });

  it('reports coverage as the coverage analysis asks: per test, all as static, or none', async (t) => {
    const dir = project(t, { 'a.test.mjs': fixture("cover('s');", "it('covers', () => { cover('t'); });") });
    const runner = await initRunner(['a.test.mjs']);
    const coverage = async (coverageAnalysis: DryRunOptions['coverageAnalysis']) =>
      fixtureCoverage(complete(await settle(runner.dryRun({ ...dryRun, coverageAnalysis }))).mutantCoverage);

    assert.deepEqual(await coverage('perTest'), {
      static: { s: 1 },
      perTest: { [`${join(dir, 'a.test.mjs')} > covers`]: { t: 1 } },
    });
    assert.deepEqual(await coverage('all'), { static: { s: 1, t: 1 }, perTest: {} });
    assert.equal(await coverage('off'), undefined);
  });

  it('attributes coverage to the test whose work makes it: a parent after an awaited subtest, an unawaited one', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "it('awaits', async (t) => {",
        "  await t.test('child', () => { cover('awaited child'); });",
        "  cover('parent after await');",
        '});',
        "it('leaves', (t) => {",
        "  t.test('child', async () => { await new Promise((resolve) => setTimeout(resolve, 1000)); cover('late child'); });",
        '});',
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');
    // Node.js 22 cancels the unawaited subtest when its parent ends, which fails it, and the hook ends a file with a
    // failed test once node:test has finished its tests, without waiting for the work they left behind.
    const cancelled = Number(process.versions.node.split('.')[0]) < 24;

    const { mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(fixtureCoverage(mutantCoverage), {
      static: {},
      perTest: {
        [`${a} > awaits`]: { 'parent after await': 1 },
        [`${a} > awaits > child`]: { 'awaited child': 1 },
        ...(!cancelled && { [`${a} > leaves > child`]: { 'late child': 1 } }),
      },
    });
  });

  it("counts the work of beforeEach and afterEach hooks as coverage of the test they run for, and a beforeEach hook's as static for a shared name", async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { afterEach, beforeEach } from 'node:test';",
        "beforeEach(() => { cover('beforeEach'); });",
        "afterEach(async () => { await null; cover('afterEach'); });",
        "it('first', () => {});",
        "describe('suite', () => {",
        "  beforeEach((t, done) => { setImmediate(() => { cover('callback beforeEach'); done(); }); });",
        "  it('second', async (t) => {",
        "    t.beforeEach(() => { cover('t.beforeEach'); });",
        "    await t.test('child', () => {});",
        '  });',
        '});',
        "it('same', () => {});",
        "it('same', () => {});",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');
    const hooks = { beforeEach: 1, afterEach: 1 };

    const { mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(fixtureCoverage(mutantCoverage), {
      static: { beforeEach: 2 },
      perTest: {
        [`${a} > first`]: hooks,
        [`${a} > suite > second`]: { ...hooks, 'callback beforeEach': 1 },
        [`${a} > suite > second > child`]: { ...hooks, 'callback beforeEach': 1, 't.beforeEach': 1 },
        [`${a} > same`]: { afterEach: 1 },
        [`${a} > same (2)`]: { afterEach: 1 },
      },
    });
  });

  /**
   * A file whose first test starts a descendant that the second test tells to cover `late` and end, and whose third
   * test starts one that covers `inside` and ends while the test waits for it.
   */
  const outliving = (start: string, ...imports: string[]) =>
    fixture(
      "import { once } from 'node:events';",
      ...imports,
      `const start = () => ${start};`,
      'let outlives;',
      "it('starts', () => { outlives = start(); });",
      "it('covers later', async () => { cover('b'); outlives.send('late'); await once(outlives, 'exit'); });",
      "it('waits', async () => { const inside = start(); inside.send('inside'); await once(inside, 'exit'); });",
    );
  /** The time between two tests, when no test is current, makes `late` static as well. */
  const outlivingCoverage = (file: string) => ({
    static: { late: 1 },
    perTest: {
      [`${file} > starts`]: { late: 1 },
      [`${file} > covers later`]: { b: 1, late: 1 },
      [`${file} > waits`]: { inside: 1 },
    },
  });

  it('gives the coverage of a worker thread that outlives the test that started it to every test it overlapped', async (t) => {
    const dir = project(t, {
      'worker.mjs': [
        "import { parentPort } from 'node:worker_threads';",
        cover,
        "parentPort.once('message', (id) => { cover(id); parentPort.close(); });",
      ].join('\n'),
      'a.test.mjs': outliving(
        "Object.assign(new Worker(new URL('./worker.mjs', import.meta.url)), { send(id) { this.postMessage(id); } })",
        "import { Worker } from 'node:worker_threads';",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);

    const { mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(fixtureCoverage(mutantCoverage), outlivingCoverage(join(dir, 'a.test.mjs')));
  });

  it('gives the coverage of a child process that outlives the test that started it to every test it overlapped', async (t) => {
    const child = `${cover} process.once('message', (id) => { cover(id); process.disconnect(); });`;
    const dir = project(t, {
      'a.test.mjs': outliving(
        `spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })`,
        "import { spawn } from 'node:child_process';",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);

    const { mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(fixtureCoverage(mutantCoverage), outlivingCoverage(join(dir, 'a.test.mjs')));
  });

  it('gives the coverage of a worker thread that a test starts and its awaited subtest uses to that subtest', async (t) => {
    const dir = project(t, {
      'worker.mjs': [
        "import { parentPort } from 'node:worker_threads';",
        cover,
        "parentPort.once('message', (id) => { cover(id); parentPort.close(); });",
      ].join('\n'),
      'a.test.mjs': fixture(
        "import { once } from 'node:events';",
        "import { Worker } from 'node:worker_threads';",
        "it('server', async (t) => {",
        "  const worker = new Worker(new URL('./worker.mjs', import.meta.url));",
        "  await t.test('talks', async () => { worker.postMessage('m'); await once(worker, 'exit'); });",
        '});',
      ),
    });
    const a = join(dir, 'a.test.mjs');
    const runner = await initRunner(['a.test.mjs']);

    const { mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(fixtureCoverage(mutantCoverage), {
      static: {},
      perTest: { [`${a} > server`]: { m: 1 }, [`${a} > server > talks`]: { m: 1 } },
    });
  });

  it('gives the coverage of a child process that covers a line during the test that started it, and ends during a later test, to both tests', async (t) => {
    const child = `${cover} process.on('message', (id) => { if (id === 'end') { process.disconnect(); } else { cover(id); process.send(id); } });`;
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { once } from 'node:events';",
        "import { spawn } from 'node:child_process';",
        'let child;',
        "it('starts', async () => {",
        `  child = spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });`,
        "  child.send('m');",
        "  await once(child, 'message');",
        '});',
        "it('covers too', async () => { cover('m'); child.send('end'); await once(child, 'exit'); });",
      ),
    });
    const a = join(dir, 'a.test.mjs');
    const runner = await initRunner(['a.test.mjs']);

    const { mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(fixtureCoverage(mutantCoverage), {
      static: { m: 1 },
      perTest: { [`${a} > starts`]: { m: 1 }, [`${a} > covers too`]: { m: 2 } },
    });
  });

  /**
   * Waits, at most 2 s, for the record of a process the test started, which the process writes while it runs in the
   * dry run.
   */
  const recorded = [
    "import { existsSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'const recorded = async (name) => {',
    `  const path = join(process.env.${envNames.out}, name);`,
    '  for (let wait = 0; wait < 100 && !existsSync(path); wait++) await new Promise((resolve) => setTimeout(resolve, 20));',
    '};',
  ];

  it('keeps the coverage of a worker thread that the test ends with worker.terminate() after it covered a line', async (t) => {
    const dir = project(t, {
      'worker.mjs': [
        "import { parentPort } from 'node:worker_threads';",
        cover,
        "cover('terminated');",
        "parentPort.postMessage('covered');",
        'setInterval(() => {}, 1_000);',
      ].join('\n'),
      'a.test.mjs': fixture(
        "import { once } from 'node:events';",
        "import { Worker } from 'node:worker_threads';",
        ...recorded,
        "it('terminates', async () => {",
        "  const worker = new Worker(new URL('./worker.mjs', import.meta.url));",
        "  await once(worker, 'message');",
        '  await recorded(`${process.pid}.${worker.threadId}.json`);',
        '  await worker.terminate();',
        '});',
      ),
    });
    const runner = await initRunner(['a.test.mjs']);

    const { mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(fixtureCoverage(mutantCoverage), {
      static: {},
      perTest: { [`${join(dir, 'a.test.mjs')} > terminates`]: { terminated: 1 } },
    });
  });

  it('keeps the coverage of a child process that the test ends with child.kill() after it covered a line', async (t) => {
    const child = `${cover} cover('killed'); process.send('covered'); setInterval(() => {}, 1_000);`;
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { spawn } from 'node:child_process';",
        "import { once } from 'node:events';",
        ...recorded,
        "it('kills', async () => {",
        `  const child = spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });`,
        "  await once(child, 'message');",
        '  await recorded(`${child.pid}.0.json`);',
        '  child.kill();',
        "  await once(child, 'exit');",
        '});',
      ),
    });
    const runner = await initRunner(['a.test.mjs']);

    const { mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(fixtureCoverage(mutantCoverage), {
      static: {},
      perTest: { [`${join(dir, 'a.test.mjs')} > kills`]: { killed: 1 } },
    });
  });

  it(
    'keeps the coverage of a child process that the test ends with child.kill() right after it covered a line',
    // eslint-disable-next-line node-test/no-skip-test -- POSIX only, with the reason as its value
    { skip: process.platform === 'win32' && 'Windows has no signals to catch: every kill is TerminateProcess' },
    async (t) => {
      const child = `${cover} cover('killed'); process.send('covered'); setInterval(() => {}, 1_000);`;
      const dir = project(t, {
        'a.test.mjs': fixture(
          "import { spawn } from 'node:child_process';",
          "import { once } from 'node:events';",
          "it('kills', async () => {",
          `  const child = spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });`,
          "  await once(child, 'message');",
          '  child.kill();',
          "  await once(child, 'exit');",
          '});',
        ),
      });
      const runner = await initRunner(['a.test.mjs']);

      const { mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

      assert.deepEqual(fixtureCoverage(mutantCoverage), {
        static: {},
        perTest: { [`${join(dir, 'a.test.mjs')} > kills`]: { killed: 1 } },
      });
    },
  );

  it('runs the tests of a suite or test asking for concurrency one at a time, for coverage of their own', async (t) => {
    const interleaved = (name: string) =>
      `async () => { cover('${name} 1'); await new Promise((resolve) => setImmediate(resolve)); cover('${name} 2'); }`;
    const dir = project(t, {
      'a.test.mjs': fixture(
        "describe('suite', { concurrency: true }, () => {",
        `  it('first', ${interleaved('first')});`,
        `  it('second', ${interleaved('second')});`,
        '});',
        "it('parent', { concurrency: 2 }, async (t) => {",
        `  const child = t.test('child', ${interleaved('child')});`,
        `  await Promise.all([child, t.test('sibling', ${interleaved('sibling')})]);`,
        '});',
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    const { mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(fixtureCoverage(mutantCoverage), {
      static: {},
      perTest: {
        [`${a} > suite > first`]: { 'first 1': 1, 'first 2': 1 },
        [`${a} > suite > second`]: { 'second 1': 1, 'second 2': 1 },
        [`${a} > parent > child`]: { 'child 1': 1, 'child 2': 1 },
        [`${a} > parent > sibling`]: { 'sibling 1': 1, 'sibling 2': 1 },
      },
    });
  });
});
