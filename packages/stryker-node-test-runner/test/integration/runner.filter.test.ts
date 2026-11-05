import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { MutantRunStatus } from '@stryker-mutator/api/test-runner';

import { lzTestFor } from '@layzee/node-test-extensions';
import { envNames } from '../../src/record.ts';
import {
  activeMutant,
  complete,
  dryRun,
  failed,
  failing,
  fixture,
  initRunner,
  mutantRunOptions,
  passed,
  passing,
  project,
  settle,
  shareCompileCache,
  summary,
  withoutDuration,
} from '../runner.fixtures.ts';

shareCompileCache();

describe('LzNodeTestTestRunner filter, bail and mutant activation', () => {
  it('runs neither the tests outside the filter nor their beforeEach and afterEach hooks', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { afterEach, beforeEach } from 'node:test';",
        "const failFor = (name) => (t) => { if (t.name !== 'selected') throw new Error(name + ' ran for ' + t.name); };",
        "beforeEach(failFor('beforeEach'));",
        "afterEach(failFor('afterEach'));",
        "it('selected', () => {});",
        "it('unselected', () => {});",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const testFilter = [`${join(dir, 'a.test.mjs')} > selected`];

    assert.deepEqual(withoutDuration(await settle(runner.mutantRun(mutantRunOptions({ testFilter })))), {
      status: MutantRunStatus.Survived,
      nrOfTests: 1,
    });
  });

  it("runs the dry run's test files in another runner's mutant runs, though Stryker's testFiles name them by absolute path", async (t) => {
    const kills = fixture(`it('kills', () => { assert.equal(process.env.${activeMutant}, undefined); });`);
    // Stryker hands the dry run the sandbox copies of its absolute testFiles, and every runner the original paths.
    const dir = project(t, { 'a.test.mjs': kills, 'original/a.test.mjs': kills });
    const options = { testFiles: [join(dir, 'original', 'a.test.mjs')] };
    const dryRunner = await initRunner(['none.test.mjs'], undefined, options);
    const a = join(dir, 'a.test.mjs');

    assert.deepEqual(summary(complete(await settle(dryRunner.dryRun({ ...dryRun, testFiles: [a] }))).tests), [
      passed(`${a} > kills`),
    ]);

    const mutantRunner = await initRunner(['none.test.mjs'], undefined, options);
    const result = await settle(mutantRunner.mutantRun(mutantRunOptions({ testFilter: [`${a} > kills`] })));

    assert.equal(result.status, MutantRunStatus.Killed);
  });

  it('runs the bodies of the suites outside the filter, but none of their hooks', async (t) => {
    const fail = (hook: string) => `() => { throw new Error('${hook} ran'); }`;
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import test, { after, afterEach, before, beforeEach } from 'node:test';",
        'const ran = [];',
        "describe('selected', () => {",
        "  before(() => { ran.push('before'); });",
        "  beforeEach(() => { ran.push('beforeEach'); });",
        "  afterEach(() => { ran.push('afterEach'); });",
        "  after(() => { assert.deepEqual(ran, ['unselected body', 'nested body', 'before', 'beforeEach', 'runs', 'afterEach']); });",
        "  it('runs', () => { ran.push('runs'); });",
        '});',
        "describe('unselected', () => {",
        "  ran.push('unselected body');",
        `  before(${fail('before')});`,
        `  beforeEach(${fail('beforeEach')});`,
        `  test.afterEach(${fail('afterEach')});`,
        `  after(${fail('after')});`,
        "  it('skipped', () => {});",
        "  describe('nested', () => {",
        "    ran.push('nested body');",
        `    test.before(${fail('nested before')});`,
        `    test.after(${fail('nested after')});`,
        "    it('skipped too', () => {});",
        '  });',
        '});',
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    assert.deepEqual(
      withoutDuration(await settle(runner.mutantRun(mutantRunOptions({ testFilter: [`${a} > selected > runs`] })))),
      {
        status: MutantRunStatus.Survived,
        nrOfTests: 1,
      },
    );
  });

  it('stops after the first file with a failure, and a mutant run after any failure, unless bail is off', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        // node:test reports the first tests of a file once its reporters have started, and bailing acts on reported
        // failures; waiting a turn lets the reporters start before the first failure.
        "it('passes', async () => { await new Promise((resolve) => setImmediate(resolve)); });",
        "it('fails', () => { throw new Error('expected failure'); });",
        "it('fails later', () => { throw new Error('later failure'); });",
        "it('calls back later', (t, done) => { done(new Error('callback failure')); });",
      ),
      'b.test.mjs': passing,
    });
    const runner = await initRunner(['b.test.mjs', 'a.test.mjs']);
    const a = join(dir, 'a.test.mjs');
    const passedA = passed(`${a} > passes`);
    const failedA = failed(`${a} > fails`, 'expected failure');
    const laterA = [
      failed(`${a} > fails later`, 'later failure'),
      failed(`${a} > calls back later`, 'callback failure'),
    ];
    const passedB = passed(`${join(dir, 'b.test.mjs')} > passes`);

    assert.deepEqual(summary(complete(await settle(runner.dryRun(dryRun))).tests), [passedA, failedA, ...laterA]);
    assert.deepEqual(summary(complete(await settle(runner.dryRun({ ...dryRun, disableBail: true }))).tests), [
      passedA,
      failedA,
      ...laterA,
      passedB,
    ]);
    assert.deepEqual(withoutDuration(await settle(runner.mutantRun(mutantRunOptions()))), {
      status: MutantRunStatus.Killed,
      killedBy: [failedA.id],
      failureMessage: 'expected failure',
      nrOfTests: 2,
    });
    assert.deepEqual(withoutDuration(await settle(runner.mutantRun(mutantRunOptions({ disableBail: true })))), {
      status: MutantRunStatus.Killed,
      killedBy: [failedA.id, ...laterA.map((test) => test.id)],
      failureMessage: 'expected failure',
      nrOfTests: 5,
    });
  });

  it('runs only the filtered tests of the files that contain them, as a mutant run', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "it('sees the mutant', () => {",
        `  assert.equal(process.env.${activeMutant}, 'fixture-mutant');`,
        `  assert.equal(process.env.${envNames.dryRun}, 'false');`,
        '});',
        "it('is filtered out', () => { throw new Error('ran a filtered test'); });",
      ),
      'b.test.mjs': failing,
    });
    const runner = await initRunner(['*.test.mjs']);
    const testFilter = [`${join(dir, 'a.test.mjs')} > sees the mutant`];

    assert.deepEqual(withoutDuration(await settle(runner.mutantRun(mutantRunOptions({ testFilter })))), {
      status: MutantRunStatus.Survived,
      nrOfTests: 1,
    });
  });

  it("runs every test of a file that a mutant run's filter names, as Stryker does with --testFiles", async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture("it('passes', () => {});", "it('fails', () => { throw new Error('expected failure'); });"),
      'b.test.mjs': failing,
    });
    const runner = await initRunner(['*.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    assert.deepEqual(withoutDuration(await settle(runner.mutantRun(mutantRunOptions({ testFilter: [a] })))), {
      status: MutantRunStatus.Killed,
      killedBy: [`${a} > fails`],
      failureMessage: 'expected failure',
      nrOfTests: 2,
    });
  });

  it("runs only the files of Stryker's --testFiles in the dry run and every runner's mutant runs, also outside lzNodeTest.testFiles", async (t) => {
    const dir = project(t, { 'a.test.mjs': passing, 'b.test.mjs': failing, 'c.spec.mjs': failing });
    const options = { testFiles: ['c.spec.mjs'] };
    const runner = await initRunner(['*.test.mjs'], {}, options);
    const c = join(dir, 'c.spec.mjs');
    const killedByC = {
      status: MutantRunStatus.Killed,
      killedBy: [`${c} > fails`],
      failureMessage: 'expected failure',
      nrOfTests: 1,
    };

    assert.deepEqual(summary(complete(await settle(runner.dryRun({ ...dryRun, testFiles: ['c.spec.mjs'] }))).tests), [
      failed(`${c} > fails`, 'expected failure'),
    ]);

    const other = await initRunner(['*.test.mjs'], {}, options);

    assert.deepEqual(
      withoutDuration(await settle(other.mutantRun(mutantRunOptions({ testFilter: [`${c} > fails`] })))),
      killedByC,
    );
    assert.deepEqual(withoutDuration(await settle(other.mutantRun(mutantRunOptions()))), killedByC);
  });

  it('reports a statically activated mutant that breaks loading the test file as a runtime error', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        `if (process.env.${activeMutant} === 'fixture-mutant') throw new Error('module-level mutant');`,
        "it('passes', () => {});",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const a = join(dir, 'a.test.mjs');

    assert.deepEqual(summary(complete(await settle(runner.dryRun(dryRun))).tests), [passed(`${a} > passes`)]);
    const result = await settle(runner.mutantRun(mutantRunOptions({ mutantActivation: 'static' })));
    assert.strictEqual(result.status, MutantRunStatus.Error);
    assert.match(result.errorMessage, /Error: module-level mutant/);
  });

  it("activates a mutant from the start in a file that the filter names whole, as Stryker's --testFiles names it for a static mutant", async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        `const greeting = process.env.${activeMutant} || globalThis.__stryker__.activeMutant ? 'mutated' : 'original';`,
        "it('greets', () => { assert.equal(greeting, 'original'); });",
      ),
    });
    const runner = await initRunner(['a.test.mjs'], undefined, { testFiles: ['a.test.mjs'] });
    const a = join(dir, 'a.test.mjs');
    // How Stryker 10.1 plans a static mutant when --testFiles is set: the test files as the filter, runtime activation.
    const result = await settle(
      runner.mutantRun(mutantRunOptions({ testFilter: [a], mutantActivation: 'runtime', reloadEnvironment: true })),
    );

    assert.strictEqual(result.status, MutantRunStatus.Killed);
    assert.deepEqual(result.killedBy, [`${a} > greets`]);
  });

  it('activates a mutant once the tests start when activation is runtime, also in processes they start', async (t) => {
    const child = `process.exitCode = process.env.${activeMutant} === 'fixture-mutant' ? 0 : 1;`;
    const dir = project(t, {
      'a.test.mjs': fixture(
        `if (process.env.${activeMutant} || globalThis.__stryker__.activeMutant) {`,
        "  throw new Error('module-level mutant');",
        '}',
        "it('sees the mutant', () => {",
        "  assert.equal(globalThis.__stryker__.activeMutant, 'fixture-mutant');",
        `  assert.equal(spawnSync(process.execPath, ['-e', ${JSON.stringify(child)}]).status, 0);`,
        '});',
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const testFilter = [`${join(dir, 'a.test.mjs')} > sees the mutant`];

    assert.deepEqual(
      withoutDuration(await settle(runner.mutantRun(mutantRunOptions({ mutantActivation: 'runtime', testFilter })))),
      {
        status: MutantRunStatus.Survived,
        nrOfTests: 1,
      },
    );
  });

  lzTestFor([
    { hooks: 'the before hooks of suites', file: 'a.test.mjs', test: 'suite > runs' },
    { hooks: 'beforeEach hooks', file: 'b.test.mjs', test: 'runs' },
  ])('activates a runtime mutant before $hooks', async ({ file, test }, t) => {
    const active = `const active = () => process.env.${activeMutant} || globalThis.__stryker__.activeMutant;`;
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { before } from 'node:test';",
        active,
        "before(() => { if (active()) throw new Error('top-level before hook ran mutated'); });",
        "describe('suite', () => {",
        "  before(() => { if (!active()) throw new Error('before hook ran unmutated'); });",
        "  it('runs', () => {});",
        '});',
      ),
      'b.test.mjs': fixture(
        "import { beforeEach } from 'node:test';",
        active,
        "beforeEach((t, done) => done(active() ? undefined : new Error('beforeEach hook ran unmutated')));",
        "it('runs', () => {});",
      ),
    });
    const runner = await initRunner(['*.test.mjs']);
    const testFilter = [`${join(dir, file)} > ${test}`];

    assert.deepEqual(
      withoutDuration(await settle(runner.mutantRun(mutantRunOptions({ mutantActivation: 'runtime', testFilter })))),
      {
        status: MutantRunStatus.Survived,
        nrOfTests: 1,
      },
    );
  });
});
