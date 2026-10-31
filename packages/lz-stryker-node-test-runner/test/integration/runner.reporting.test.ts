import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { MutantRunStatus, TestStatus } from '@stryker-mutator/api/test-runner';

import {
  complete,
  dryRun,
  failed,
  firstFixtureLine,
  fixture,
  fixtureCoverage,
  initRunner,
  mutantRunOptions,
  passed,
  project,
  settle,
  shareCompileCache,
  skipped,
  summary,
  withoutDuration,
} from '../runner.fixtures.ts';

shareCompileCache();

describe('LzStrykerNodeTestRunner results', () => {
  it('reports where the test file declares a suite that fails by itself', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { before } from 'node:test';",
        "describe('once', () => {",
        "  before(() => { throw new Error('before failure'); });",
        "  it('never runs', () => {});",
        '});',
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    const { tests } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(
      tests.map(({ id, startPosition }) => ({ id, startPosition })),
      [
        { id: `${a} > once > never runs`, startPosition: { line: firstFixtureLine + 3, column: 2 } },
        { id: `${a} > once`, startPosition: { line: firstFixtureLine + 1, column: 0 } },
      ],
    );
  });

  it('reports where the test file declares each skipped test, however it is skipped', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { test } from 'node:test';",
        "it.skip('it.skip', () => {});",
        "test.skip('test.skip');",
        "it('skip option', { skip: true }, () => {});",
        "describe('suite', () => {",
        "  it.skip('nested', () => {});",
        '});',
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    const { tests } = complete(await settle(runner.dryRun(dryRun)));

    // V8 places a call of a shorthand such as `it.skip` at the shorthand's name.
    assert.deepEqual(
      tests.map(({ id, status, startPosition }) => ({ id, status, startPosition })),
      [
        {
          id: `${a} > it.skip`,
          status: TestStatus.Skipped,
          startPosition: { line: firstFixtureLine + 1, column: 3 },
        },
        {
          id: `${a} > test.skip`,
          status: TestStatus.Skipped,
          startPosition: { line: firstFixtureLine + 2, column: 5 },
        },
        {
          id: `${a} > skip option`,
          status: TestStatus.Skipped,
          startPosition: { line: firstFixtureLine + 3, column: 0 },
        },
        {
          id: `${a} > suite > nested`,
          status: TestStatus.Skipped,
          startPosition: { line: firstFixtureLine + 5, column: 5 },
        },
      ],
    );
  });

  it('reports a skipped suite as one skipped result, without running its body to find its tests', async (t) => {
    const body = "() => { cover('suite body'); it('inside', () => {}); }";
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { suite } from 'node:test';",
        `describe.skip('describe.skip', ${body});`,
        `suite.skip('suite.skip', ${body});`,
        `describe('skip option', { skip: 'not now' }, ${body});`,
        "describe('outer', () => {",
        `  describe.skip('nested', ${body});`,
        "  it('passes', () => {});",
        '});',
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    const skippedAt = (name: string, line: number, column: number) => ({
      id: `${a} > ${name}`,
      name,
      status: TestStatus.Skipped,
      startPosition: { line, column },
    });

    const { tests, mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(
      tests.map(({ id, name, status, startPosition }) => ({ id, name, status, startPosition })),
      [
        skippedAt('describe.skip', firstFixtureLine + 1, 9),
        skippedAt('suite.skip', firstFixtureLine + 2, 6),
        skippedAt('skip option', firstFixtureLine + 3, 0),
        skippedAt('outer > nested', firstFixtureLine + 5, 11),
        {
          id: `${a} > outer > passes`,
          name: 'outer > passes',
          status: TestStatus.Success,
          startPosition: { line: firstFixtureLine + 6, column: 2 },
        },
      ],
    );
    assert.deepEqual(fixtureCoverage(mutantCoverage), { static: {}, perTest: {} });
  });

  it("reports a failing `after` hook outside any suite as the test file's hook, where it is declared", async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { after } from 'node:test';",
        "it('passes', () => {});",
        "after(() => { throw new Error('after failure'); });",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');
    const hook = `${a} > "after" hook`;

    const { tests } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(
      tests.map(({ id, name, status, startPosition }) => ({ id, name, status, startPosition })),
      [
        {
          id: `${a} > passes`,
          name: 'passes',
          status: TestStatus.Success,
          startPosition: { line: firstFixtureLine + 1, column: 0 },
        },
        {
          id: hook,
          name: '"after" hook',
          status: TestStatus.Failed,
          startPosition: { line: firstFixtureLine + 2, column: 0 },
        },
      ],
    );
    assert.deepEqual(withoutDuration(await settle(runner.mutantRun(mutantRunOptions()))), {
      status: MutantRunStatus.Killed,
      killedBy: [hook],
      failureMessage: 'after failure',
      nrOfTests: 2,
    });
  });

  it('reports subtests and expectFailure tests with ids and coverage of their own, and filters subtests', async (t) => {
    // Node.js 22 has no expectFailure.
    const expectFailure = 'expectFailure' in it && typeof it.expectFailure === 'function';
    const dir = project(t, {
      'a.test.mjs': fixture(
        "it('parent', async (t) => {",
        "  cover('parent');",
        "  await t.test('child', () => { cover('child'); });",
        "  await t.test('failing child', () => { throw new Error('child failure'); });",
        "  cover('parent again');",
        '});',
        "it.expectFailure?.('expects a failure', () => { cover('expected'); throw new Error('expected'); });",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    const { tests, mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(summary(tests), [
      passed(`${a} > parent > child`),
      failed(`${a} > parent > failing child`, 'child failure'),
      failed(`${a} > parent`, '1 subtest failed'),
      ...(expectFailure ? [passed(`${a} > expects a failure`)] : []),
    ]);
    assert.deepEqual(fixtureCoverage(mutantCoverage)?.perTest, {
      [`${a} > parent`]: { parent: 1, 'parent again': 1 },
      [`${a} > parent > child`]: { child: 1 },
      ...(expectFailure && { [`${a} > expects a failure`]: { expected: 1 } }),
    });
    assert.deepEqual(
      withoutDuration(await settle(runner.mutantRun(mutantRunOptions({ testFilter: [`${a} > parent > child`] })))),
      {
        status: MutantRunStatus.Survived,
        nrOfTests: 2,
      },
    );
  });

  it('names the suites and tests a running test registers with it and describe after it, as node:test does', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "it('outer', async () => {",
        "  it('inner', () => { cover('inner'); });",
        "  describe('suite', () => { it('in suite', () => { cover('in suite'); }); });",
        '  await new Promise((resolve) => setImmediate(resolve));',
        "  it('after await', () => { cover('after await'); });",
        '});',
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');
    const ids: readonly [string, string, string] = [
      `${a} > outer > inner`,
      `${a} > outer > suite > in suite`,
      `${a} > outer > after await`,
    ];

    const { tests, mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(
      tests.map(({ id, startPosition }) => ({ id, line: startPosition?.line })),
      [
        { id: ids[0], line: firstFixtureLine + 1 },
        { id: ids[1], line: firstFixtureLine + 2 },
        { id: ids[2], line: firstFixtureLine + 4 },
        { id: `${a} > outer`, line: firstFixtureLine },
      ],
    );
    assert.deepEqual(fixtureCoverage(mutantCoverage)?.perTest, {
      [ids[0]]: { inner: 1 },
      [ids[1]]: { 'in suite': 1 },
      [ids[2]]: { 'after await': 1 },
    });
    assert.deepEqual(withoutDuration(await settle(runner.mutantRun(mutantRunOptions({ testFilter: [ids[2]] })))), {
      status: MutantRunStatus.Survived,
      nrOfTests: 2,
    });
  });

  it('reports where the test file declares each test, also through a helper', async (t) => {
    const dir = project(t, {
      'helper.mjs': "import { it } from 'node:test';\nexport const declare = () => it('from a helper', () => {});\n",
      'a.test.mjs': fixture(
        "import { declare } from './helper.mjs';",
        "it('first', () => {});",
        "describe('suite', () => {",
        "  it('nested', () => {});",
        '});',
        'declare();',
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    const { tests } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(
      tests.map(({ id, startPosition }) => ({ id, startPosition })),
      [
        { id: `${a} > first`, startPosition: { line: firstFixtureLine + 1, column: 0 } },
        { id: `${a} > suite > nested`, startPosition: { line: firstFixtureLine + 3, column: 2 } },
        { id: `${a} > from a helper`, startPosition: { line: firstFixtureLine + 5, column: 0 } },
      ],
    );
  });

  it('gives tests without a name the ids node:test gives them, for results, coverage and the filter', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "it('', () => { cover('empty'); });",
        "it({ timeout: 1000 }, function optionsFirst() { cover('options first'); });",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    const { tests, mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(
      tests.map(({ id }) => id),
      [`${a} > <anonymous>`, `${a} > optionsFirst`],
    );
    assert.deepEqual(fixtureCoverage(mutantCoverage)?.perTest, {
      [`${a} > <anonymous>`]: { empty: 1 },
      [`${a} > optionsFirst`]: { 'options first': 1 },
    });
    assert.deepEqual(
      withoutDuration(await settle(runner.mutantRun(mutantRunOptions({ testFilter: [`${a} > <anonymous>`] })))),
      {
        status: MutantRunStatus.Survived,
        nrOfTests: 1,
      },
    );
  });

  it('gives same-named tests of one parent, and names with the separator, ids of their own throughout', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "describe('s', () => {",
        "  it('works', () => { cover('first'); });",
        "  it('works', () => { cover('second'); });",
        '});',
        "describe('a', () => { it('b', () => { cover('nested'); }); });",
        "it('a > b', () => { cover('separator'); });",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');
    const ids: readonly [string, string, string, string] = [
      `${a} > s > works`,
      `${a} > s > works (2)`,
      `${a} > a > b`,
      `${a} > a \\> b`,
    ];

    const { tests, mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(
      tests.map(({ id, startPosition }) => ({ id, line: startPosition?.line })),
      [
        { id: ids[0], line: firstFixtureLine + 1 },
        { id: ids[1], line: firstFixtureLine + 2 },
        { id: ids[2], line: firstFixtureLine + 4 },
        { id: ids[3], line: firstFixtureLine + 5 },
      ],
    );
    assert.deepEqual(fixtureCoverage(mutantCoverage)?.perTest, {
      [ids[0]]: { first: 1 },
      [ids[1]]: { second: 1 },
      [ids[2]]: { nested: 1 },
      [ids[3]]: { separator: 1 },
    });
    assert.deepEqual(withoutDuration(await settle(runner.mutantRun(mutantRunOptions({ testFilter: [ids[1]] })))), {
      status: MutantRunStatus.Survived,
      nrOfTests: 1,
    });
  });

  it('names the tests inside only and todo suites after their suites', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture("describe.only('only suite', () => { it.only('runs', () => { cover('only'); }); });"),
      'b.test.mjs': fixture(
        "describe.todo('todo suite', () => {",
        "  it('fails', () => { throw new Error('not done'); });",
        '});',
      ),
    });
    const runner = await initRunner(['*.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    const { tests, mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(summary(tests), [
      passed(`${a} > only suite > runs`),
      skipped(`${join(dir, 'b.test.mjs')} > todo suite > fails`),
    ]);
    assert.deepEqual(fixtureCoverage(mutantCoverage)?.perTest, { [`${a} > only suite > runs`]: { only: 1 } });
  });

  it('runs every test of a file with only tests, as node --test does without --test-only', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "it.only('only shorthand', () => {});",
        "it('only option', { only: true }, () => {});",
        "it('other', () => {});",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    assert.deepEqual(summary(complete(await settle(runner.dryRun(dryRun))).tests), [
      passed(`${a} > only shorthand`),
      passed(`${a} > only option`),
      passed(`${a} > other`),
    ]);
  });

  it('runs the plain subtests of a test that calls t.runOnly(true), as node --test does without --test-only', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "it('runs only', async (t) => { t.runOnly(true); await t.test('plain', () => {}); await t.test('only', { only: true }, () => {}); });",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    assert.deepEqual(summary(complete(await settle(runner.dryRun(dryRun))).tests), [
      passed(`${a} > runs only > plain`),
      passed(`${a} > runs only > only`),
      passed(`${a} > runs only`),
    ]);
  });

  it('runs only the only tests of a file under --test-only', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "it.only('only shorthand', () => {});",
        "it('only option', { only: true }, () => {});",
        "it('other', () => {});",
      ),
    });
    const runner = await initRunner(['a.test.mjs'], { nodeArgs: ['--test-only'] });
    const a = join(dir, 'a.test.mjs');

    assert.deepEqual(summary(complete(await settle(runner.dryRun(dryRun))).tests), [
      passed(`${a} > only shorthand`),
      passed(`${a} > only option`),
    ]);
  });

  it('reports skipped and todo tests as skipped, so a failing todo test kills no mutant', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "it('passes', () => {});",
        "it('is not done', { todo: true }, () => { throw new Error('todo failure'); });",
        "it.skip('is skipped', () => { throw new Error('ran a skipped test'); });",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    assert.deepEqual(summary(complete(await settle(runner.dryRun(dryRun))).tests), [
      passed(`${a} > passes`),
      skipped(`${a} > is not done`),
      skipped(`${a} > is skipped`),
    ]);
    assert.deepEqual(withoutDuration(await settle(runner.mutantRun(mutantRunOptions()))), {
      status: MutantRunStatus.Survived,
      nrOfTests: 1,
    });
  });

  it('reports a failing hook against the tests it fails, and a test that times out as failed', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { afterEach } from 'node:test';",
        "describe('each', () => {",
        "  afterEach(() => { throw new Error('afterEach failure'); });",
        "  it('passes, then its hook fails', () => {});",
        '});',
      ),
      'b.test.mjs': fixture(
        "import { after, before } from 'node:test';",
        "describe('once', () => {",
        "  before(() => { throw new Error('before failure'); });",
        "  it('never runs', () => {});",
        '});',
        "describe('last', () => {",
        "  after(() => { throw new Error('after failure'); });",
        "  it('passes', () => {});",
        '});',
        "it('times out', { timeout: 10 }, () => new Promise((resolve) => setTimeout(resolve, 200)));",
      ),
    });
    const runner = await initRunner(['*.test.mjs']);
    const a = join(dir, 'a.test.mjs');
    const b = join(dir, 'b.test.mjs');
    const failsInHook = `${a} > each > passes, then its hook fails`;

    assert.deepEqual(summary(complete(await settle(runner.dryRun({ ...dryRun, disableBail: true }))).tests), [
      failed(failsInHook, 'afterEach failure'),
      failed(`${b} > once > never runs`, 'test did not finish before its parent and was cancelled'),
      failed(`${b} > once`, 'before failure'),
      passed(`${b} > last > passes`),
      failed(`${b} > last`, 'after failure'),
      failed(`${b} > times out`, 'test timed out after 10ms'),
    ]);
    assert.deepEqual(withoutDuration(await settle(runner.mutantRun(mutantRunOptions({ testFilter: [failsInHook] })))), {
      status: MutantRunStatus.Killed,
      killedBy: [failsInHook],
      failureMessage: 'afterEach failure',
      nrOfTests: 1,
    });
  });

  it('reports callback-style tests once node:test calls them back', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "it('calls back', (t, done) => { setImmediate(done); });",
        "it('calls back with an error', (t, done) => { setImmediate(() => done(new Error('late failure'))); });",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);

    const { tests } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(summary(tests), [
      passed(`${join(dir, 'a.test.mjs')} > calls back`),
      failed(`${join(dir, 'a.test.mjs')} > calls back with an error`, 'late failure'),
    ]);
  });
});
