import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import type { InstrumenterContext } from '@stryker-mutator/api/core';

import { lzTestEach } from '@layzee/node-test-extensions';
import { lzTestFor } from '@layzee/node-test-extensions';
import {
  install,
  installed,
  reporting,
  watchdog,
  wrappedNodeTest,
  type HookDependencies,
  type TestEvent,
} from '../../src/hook-core.ts';
import { envNames } from '../../src/record.ts';
import {
  bodyOf,
  callable,
  fakeNodeTest,
  fileEnv,
  harness,
  hooksOf,
  importRedirected,
  installedHarness,
  lifetime,
  out,
  rawBodyOf,
  reported,
  testFile,
  testContext,
  spans,
  type Fn,
  type Harness,
  type TestDetails,
} from '../hook-core.fixtures.ts';
import { member } from '../reflect.fixtures.ts';

/** The `after` hooks registered with node:test, in order; the hook's own comes first. */
function afterHooks(fake: ReturnType<typeof fakeNodeTest>): (Fn | undefined)[] {
  return fake.registrations
    .filter(({ kind }) => kind === 'after')
    .map(({ rest: [hook] }) => (typeof hook === 'function' ? callable(hook) : undefined));
}

/** A test file whose test, `name`, has run its body and been reported. */
async function ranAndReported(h: Harness, name: string, outcome: 'pass' | 'fail'): Promise<void> {
  h.wrapped().it(name, () => {});
  await bodyOf(h.fake.registrations, name)(testContext());
  report(h.deps, name, outcome);
}

function send(deps: HookDependencies, ...events: readonly TestEvent[]): void {
  const recordEvent = deps.global[reporting];
  assert.ok(recordEvent, 'the hook installed no reporting function');

  for (const event of events) {
    recordEvent(event);
  }
}

/** node:test enqueues a top-level suite or test as it registers it, unless one of its filters leaves it out. */
function enqueue(deps: HookDependencies, ...names: readonly string[]): void {
  send(deps, ...names.map((name) => ({ type: 'test:enqueue', data: { name, nesting: 0 } })));
}

function report(deps: HookDependencies, name: string, outcome: 'pass' | 'fail'): void {
  const error = { message: `${name} failed` };

  const details: TestDetails = { type: 'test', duration_ms: 2, ...(outcome === 'fail' && { error }) };

  send(deps, ...reported(name, 0, outcome, details));
}

describe('install', () => {
  it('does nothing when the runner did not start the process tree', () => {
    const { deps, calls } = harness({ [envNames.file]: testFile });

    assert.equal(install(deps), false);
    assert.deepEqual(deps.global, { globalThis: undefined });
    assert.deepEqual(calls, []);
  });

  it('does nothing when a hook is already installed in the process', () => {
    const { deps, calls } = harness(fileEnv());

    assert.equal(install(deps), true);

    const installCalls = calls.length;

    assert.equal(install(deps), false);
    assert.deepEqual(calls.slice(installCalls), []);
  });

  it('marks the process with a symbol that every copy of the hook shares', () => {
    const { deps } = installedHarness({ [envNames.out]: out });

    assert.equal(deps.global[installed], true);
    assert.equal(installed, Symbol.for('stryker-node-test-runner.hook'));
    assert.equal(reporting, Symbol.for('stryker-node-test-runner.reporting'));
    assert.equal(wrappedNodeTest, Symbol.for('stryker-node-test-runner.node-test'));
    assert.equal(watchdog, Symbol.for('stryker-node-test-runner.watchdog'));
  });

  it('keeps an existing Stryker namespace', () => {
    const ns: InstrumenterContext = { mutantCoverage: { static: { 1: 1 }, perTest: {} } };
    const { deps } = harness({ [envNames.out]: out });
    deps.global.__stryker__ = ns;
    install(deps);

    assert.equal(deps.global.__stryker__, ns);
    assert.deepEqual(ns.mutantCoverage, { static: { 1: 1 }, perTest: {} });
  });

  it('sets the hit limit and starts counting when the limit is positive', () => {
    const { deps } = installedHarness({ [envNames.out]: out, [envNames.hitLimit]: '25' });

    assert.equal(deps.global.__stryker__?.hitLimit, 25);
    assert.equal(deps.global.__stryker__.hitCount, 0);
  });

  it("watches the process's memory when the memory limit is positive, with a record of its own in the out directory", () => {
    const { deps, calls } = installedHarness({ [envNames.out]: out, [envNames.memoryLimit]: '1500' });

    const options = {
      workerData: { limitMB: 1500, recordPath: join(out, `4321.${deps.nonce}.memory.json`) },
      execArgv: [],
      env: {},
    };
    assert.deepEqual(calls, [`watchMemory ${JSON.stringify(options)}`, 'onExit']);
    assert.equal(deps.global[watchdog], 'the watchdog');
  });

  lzTestFor<readonly [string, Record<string, string>, Record<string, string>]>([
    ['', {}, {}],
    [
      ', except the compile cache when the process has one',
      { NODE_COMPILE_CACHE: 'cache' },
      { NODE_COMPILE_CACHE: 'cache' },
    ],
  ])("starts the memory watchdog without the process's environment%s", ([, env, expected]) => {
    const started: unknown[] = [];
    installedHarness(
      { [envNames.out]: out, [envNames.memoryLimit]: '1500', NODE_OPTIONS: '--require x.cjs', ...env },
      { watchMemory: (options) => started.push(options.env) },
    );

    assert.deepEqual(started, [expected]);
  });

  it('watches no memory in a thread that may not start the watchdog', () => {
    const { deps, calls } = installedHarness(
      { [envNames.out]: out, [envNames.memoryLimit]: '1500' },
      { canWatchMemory: false },
    );

    assert.deepEqual(calls, ['onExit']);
    assert.equal(deps.global[watchdog], undefined);
  });

  lzTestEach([undefined, '0', 'none'])('watches no memory with the memory limit %s', (memoryLimit) => {
    const { calls } = installedHarness({ [envNames.out]: out, [envNames.memoryLimit]: memoryLimit });

    assert.deepEqual(calls, ['onExit']);
  });

  lzTestEach([undefined, '0', 'none'])('counts no hits with the hit limit %s', (hitLimit) => {
    const { deps, records, exit } = installedHarness({ [envNames.out]: out, [envNames.hitLimit]: hitLimit });
    exit();

    assert.equal(deps.global.__stryker__?.hitLimit, undefined);
    assert.equal(deps.global.__stryker__?.hitCount, undefined);
    assert.ok(!('hitCount' in (records[0]?.record ?? {})));
  });

  it('attributes the process to the test that started it', () => {
    const { deps } = installedHarness(
      { [envNames.out]: out, [envNames.current]: `${testFile} > spawns` },
      { mainFile: '/other.mjs' },
    );

    assert.equal(deps.global.__stryker__?.currentTestId, `${testFile} > spawns`);
  });

  lzTestEach([undefined, ''])('attributes the process to no test when the current test is %j', (current) => {
    const { deps } = harness({ [envNames.out]: out, [envNames.current]: current });
    deps.global.__stryker__ = { currentTestId: 'stale' };
    install(deps);

    assert.equal(deps.global.__stryker__.currentTestId, '');
  });

  it('wraps node:test in the process that runs the test file, and makes imports of node:test give it', async () => {
    const { deps, fake, calls, hooks, wrapped } = installedHarness(fileEnv());

    assert.deepEqual(calls, ['nodeTest', 'registerHooks', 'onExit']);
    const [hook, ...more] = hooks;
    assert.ok(hook);
    assert.deepEqual(more, []);
    const names = Object.keys((await importRedirected(hook, wrapped())).module);
    assert.deepEqual(names.sort(), ['default', ...Object.keys(fake.module)].sort());

    const seen: unknown[] = [];
    wrapped().it('runs', () => {
      seen.push(deps.global.__stryker__?.currentTestId);
    });
    await bodyOf(fake.registrations, 'runs')(testContext());

    assert.deepEqual(seen, [`${testFile} > runs`]);
  });

  lzTestFor<readonly [string, Record<string, string>, string | undefined]>([
    ['a process the tests spawned', { [envNames.file]: testFile }, '/repo/child.mjs'],
    ['a process without a main file', { [envNames.file]: testFile }, undefined],
    ['a run without a test file', {}, undefined],
    ['a run without a test file, from a main file', {}, testFile],
  ])('leaves node:test and its reporter alone in %s', ([, env, mainFile]) => {
    const { deps, calls } = harness({ [envNames.out]: out, ...env }, { mainFile });

    assert.equal(install(deps), true);
    assert.deepEqual(calls, ['onExit']);
    assert.equal(deps.global[reporting], undefined);
    assert.equal(deps.global[wrappedNodeTest], undefined);
  });

  it("records the tests node:test reports in a file named after the process, marked as the test file's", () => {
    const { deps, records, exit } = installedHarness({ ...fileEnv(), [envNames.dryRun]: 'false' });
    report(deps, 'passes', 'pass');
    report(deps, 'fails', 'fail');

    exit();

    assert.deepEqual(records, [
      {
        path: join(out, `4321.0.${deps.nonce}.json`),
        record: {
          main: true,
          tests: [
            { id: `${testFile} > passes`, status: 'passed', timeSpentMs: 2 },
            { id: `${testFile} > fails`, status: 'failed', failureMessage: 'fails failed', timeSpentMs: 2 },
          ],
          lifetime,
          testSpans: spans(),
        },
      },
    ]);
  });

  it("writes a worker thread's record to a file of its own, never as the test file's", () => {
    const { deps, records, exit } = installedHarness(fileEnv(), { threadId: 3 });

    exit();

    assert.deepEqual(
      records.map(({ path, record }) => [path, record.main]),
      [[join(out, `4321.3.${deps.nonce}.json`), undefined]],
    );
  });

  it('writes the records of two processes the test file starts to different files, though they have the same pid', () => {
    const paths = [0, 1].flatMap(() => {
      const { records, exit } = installedHarness({ [envNames.out]: out }, { mainFile: '/repo/child.mjs' });
      exit();

      return records.map(({ path }) => path);
    });

    assert.equal(new Set(paths).size, 2);
  });

  it('gives the memory records of two processes with the same pid different files', () => {
    const paths = [0, 1].map(() => {
      const { calls } = installedHarness({ [envNames.out]: out, [envNames.memoryLimit]: '1500' });

      return calls[0];
    });

    assert.equal(new Set(paths).size, 2);
  });

  it('installs, but neither listens for the end nor follows the coverage of a process that may not write its record', () => {
    const persisting: string[] = [];
    const { deps, calls } = harness(
      { [envNames.out]: out, [envNames.dryRun]: 'true' },
      {
        mainFile: '/repo/child.mjs',
        canWriteRecords: false,
        every: () => persisting.push('every'),
        onBeforeExit: () => persisting.push('onBeforeExit'),
      },
    );

    assert.equal(install(deps), true);
    assert.deepEqual([...calls, ...persisting], []);
  });

  it('writes no record in a process that may not write one', () => {
    const { deps, records, exit } = installedHarness(fileEnv(), { canWriteRecords: false });
    report(deps, 'passes', 'pass');

    exit();

    assert.deepEqual(records, []);
  });

  lzTestFor<readonly [string, boolean, Record<string, number>]>([
    ['after the exit listeners of the tests, when it ends by itself', true, { exit: 1 }],
    ['before the exit listeners of the tests, when it ends through process.exit()', false, {}],
  ])('writes the record once, %s', ([, natural, exitHits]) => {
    const { deps, records, calls, exit, onExit } = installedHarness({ [envNames.out]: out, [envNames.dryRun]: 'true' });
    const coverage = { static: {}, perTest: {} };
    const ns = deps.global.__stryker__;
    assert.ok(ns);
    ns.mutantCoverage = coverage;
    onExit(() => {
      Object.assign(coverage.static, { exit: 1 });
    });
    const installCalls = calls.length;

    exit({ natural });

    assert.deepEqual(
      records.map(({ record }) => record.mutantCoverage),
      [{ static: exitHits, perTest: {} }],
    );
    assert.deepEqual(calls.slice(installCalls), natural ? ['offExit', 'onExit'] : []);
  });

  it('writes the diagnostics of errors raised after a test ended', () => {
    const { deps, records, exit } = installedHarness(fileEnv());
    const message = 'Error: Test "t" at a.test.mjs:1:1 generated asynchronous activity after the test ended.';
    send(deps, { type: 'test:diagnostic', data: { name: '', nesting: 0, message } });

    exit();

    assert.deepEqual(records[0]?.record, {
      main: true,
      tests: [],
      diagnostics: [message],
      lifetime,
      testSpans: spans(),
    });
  });

  const summary: TestEvent = { type: 'test:summary', data: { name: '', nesting: 0 } };

  lzTestFor<readonly [string, boolean, readonly TestEvent[], Record<string, boolean>]>([
    ['marks the record unfinished when it ends through process.exit() before', false, [], { unfinished: true }],
    ['leaves the record as it is when it ends through process.exit() after', false, [summary], {}],
    ['leaves the record as it is when it ends by itself without', true, [], {}],
  ])("%s node:test's summary", ([, natural, last, unfinished]) => {
    const { deps, records, exit, wrapped } = installedHarness(fileEnv());
    wrapped().it('passes', () => {});
    report(deps, 'passes', 'pass');

    send(deps, ...last);

    exit({ natural });

    assert.deepEqual(records[0]?.record, {
      main: true,
      tests: [{ id: `${testFile} > passes`, status: 'passed', timeSpentMs: 2 }],
      ...unfinished,
      lifetime,
      testSpans: spans(),
    });
  });

  it('records where the test file declares a test, named by URL as an ES module or by path as CommonJS', () => {
    const file = resolve(testFile);
    const other = pathToFileURL(resolve('/repo', 'other.ts')).href;
    const startPositions = [pathToFileURL(file).href, file, other].map((scriptName) => {
      const { deps, records, exit, wrapped } = installedHarness(
        { [envNames.out]: out, [envNames.file]: file },
        { mainFile: file, callSites: () => [{ scriptName, lineNumber: 3, columnNumber: 5 }] },
      );
      wrapped().it('declared', () => {});
      report(deps, 'declared', 'pass');
      exit();

      return records[0]?.record.tests[0]?.startPosition;
    });

    assert.deepEqual(startPositions, [{ line: 2, column: 4 }, { line: 2, column: 4 }, undefined]);
  });

  lzTestFor<readonly [string, string, readonly boolean[], { line: number; column: number }]>([
    ['the source-mapped call sites, when one is in the test file', testFile, [true], { line: 6, column: 6 }],
    [
      'the call sites as they are, when no source-mapped one is',
      join('/repo', 'src', 'a.ts'),
      [true, false],
      { line: 2, column: 4 },
    ],
  ])('records the position from %s', ([, mappedFile, reads, startPosition]) => {
    const sourceMaps: boolean[] = [];
    const { deps, records, exit, wrapped } = installedHarness(fileEnv(), {
      callSites: (frameCount, { sourceMap }) => {
        assert.equal(frameCount, 64);
        sourceMaps.push(sourceMap);

        return sourceMap
          ? [
              { scriptName: join('/repo', 'helper.ts'), lineNumber: 1, columnNumber: 1 },
              { scriptName: mappedFile, lineNumber: 7, columnNumber: 7 },
            ]
          : [{ scriptName: testFile, lineNumber: 3, columnNumber: 5 }];
      },
    });
    wrapped().it('declared', () => {});
    report(deps, 'declared', 'pass');
    exit();

    assert.deepEqual(records[0]?.record.tests[0]?.startPosition, startPosition);
    assert.deepEqual(sourceMaps, reads);
  });

  it('activates the mutant the runner names for runtime activation once a test starts', async () => {
    const { deps, fake, wrapped } = installedHarness({ ...fileEnv(), [envNames.activeMutant]: '5' });

    assert.equal(deps.global.__stryker__?.activeMutant, undefined);

    wrapped().it('runs', () => {});
    await bodyOf(fake.registrations, 'runs')(testContext());

    assert.equal(deps.global.__stryker__?.activeMutant, '5');
  });

  lzTestFor<readonly [string, readonly string[], string | undefined, string]>([
    ['without --test-only', ['--no-deprecation'], '--no-warnings', 'test'],
    ['with --test-only in its options', ['--test-only'], undefined, 'test.only'],
    ['with --test-only in NODE_OPTIONS', [], '--import x  --test-only', 'test.only'],
    ['with --test-only=true in NODE_OPTIONS', [], '--test-only=true', 'test.only'],
    ['with --test-only in NODE_OPTIONS and --no-test-only in its options', ['--no-test-only'], '--test-only', 'test'],
  ])('registers an only test as one %s', ([, execArgv, nodeOptions, kind]) => {
    const { fake, wrapped } = installedHarness({ ...fileEnv(), NODE_OPTIONS: nodeOptions }, { execArgv });
    wrapped().it.only('only', () => {});

    assert.deepEqual(
      fake.registrations.map((registration) => registration.kind).filter((registered) => registered !== 'after'),
      [kind],
    );
  });

  it('runs only the filtered tests', () => {
    const { fake, wrapped } = installedHarness({
      ...fileEnv(),
      [envNames.filter]: JSON.stringify([`${testFile} > wanted`]),
    });
    wrapped().it('wanted', () => {});
    wrapped().it('unwanted', () => {});

    assert.deepEqual(
      fake.registrations.filter(({ kind }) => kind === 'test').map(({ name, rest }) => [name, member(rest[0], 'skip')]),
      [
        ['wanted', undefined],
        ['unwanted', true],
      ],
    );
  });

  lzTestEach(['null', '{"0":"id"}', '["id",1]'])(
    'fails to install with the filter %s, which is no list of test ids',
    (filter) => {
      const { deps } = harness({ ...fileEnv(), [envNames.filter]: filter });

      assert.throws(() => install(deps), { message: `${envNames.filter} is no JSON array of test ids: ${filter}` });
    },
  );

  const bails = ['true', 'false', undefined].map((bail) => ({ bail, verb: bail === 'true' ? 'skips' : 'runs' }));

  lzTestEach(bails)('$verb later tests with bail $bail; children never bail', async ({ bail }) => {
    const env = { ...fileEnv(), [envNames.bail]: bail };
    const { deps, fake, wrapped } = installedHarness(env);
    const ran: string[] = [];
    wrapped().it('later', () => {
      ran.push('later');
    });
    report(deps, 'fails', 'fail');
    await bodyOf(fake.registrations, 'later')(testContext());

    assert.deepEqual(ran, bail === 'true' ? [] : ['later']);
    assert.ok(!(envNames.bail in env));
  });

  it('hides the test file from the processes that the test file starts', () => {
    const env = fileEnv();

    installedHarness(env);

    assert.ok(!(envNames.file in env));
  });

  describe('a process that outlives its tests', () => {
    it("registers a root `after` hook with node:test itself at the test file's first registration, before it", () => {
      const h = installedHarness(fileEnv());

      assert.deepEqual(h.fake.registrations, []);

      h.wrapped().after(() => {});
      h.wrapped().it('passes', () => {});

      assert.deepEqual(
        h.fake.registrations.map(({ kind, self }) => [kind, self === h.fake.module]),
        [
          ['after', true],
          ['after', false],
          ['test', false],
        ],
      );
    });

    it('ends a file whose test failed with exit code 1 once its tests finish, and does not mark it unfinished', async () => {
      const h = installedHarness(fileEnv());
      await ranAndReported(h, 'passes', 'pass');
      await ranAndReported(h, 'fails', 'fail');

      assert.deepEqual(h.exits, []);

      afterHooks(h.fake)[0]?.();
      h.exit({ natural: false });

      assert.deepEqual(h.exits, [1]);
      assert.deepEqual(h.records[0]?.record, {
        main: true,
        tests: [
          { id: `${testFile} > passes`, status: 'passed', timeSpentMs: 2 },
          { id: `${testFile} > fails`, status: 'failed', failureMessage: 'fails failed', timeSpentMs: 2 },
        ],
        lifetime,
        testSpans: spans('passes', 'fails'),
      });
    });

    it('ends a failed file only once node:test has reported each top-level suite and test, which comes last', () => {
      const h = installedHarness(fileEnv());
      h.wrapped().it('fails', () => {});
      h.wrapped().describe('suite', () => {
        h.wrapped().it('inner', () => {});
      });
      enqueue(h.deps, 'fails', 'suite');
      // node:test enqueues a suite's tests too, one level down.
      send(h.deps, { type: 'test:enqueue', data: { name: 'inner', nesting: 1 } });
      afterHooks(h.fake)[0]?.();
      report(h.deps, 'fails', 'fail');
      send(h.deps, {
        type: 'test:pass',
        data: { name: 'inner', nesting: 1, details: { type: 'test', duration_ms: 1 } },
      });
      // A failing root hook, reported as a failure of the file itself.
      send(h.deps, {
        type: 'test:fail',
        data: { name: testFile, nesting: 0, details: { duration_ms: 1, error: { message: 'hook failed' } } },
      });
      // node:test reports that a suite completed before it reports its result.
      send(h.deps, {
        type: 'test:complete',
        data: { name: 'suite', nesting: 0, details: { type: 'suite', duration_ms: 1 } },
      });

      assert.deepEqual(h.exits, []);

      send(h.deps, {
        type: 'test:pass',
        data: { name: 'suite', nesting: 0, details: { type: 'suite', duration_ms: 1 } },
      });

      assert.deepEqual(h.exits, [1]);
    });

    it('ends a failed file at once when node:test filters out a top-level test, as it reports no `test:enqueue` for it', () => {
      const h = installedHarness(fileEnv());
      h.wrapped().it('fails', () => {});
      h.wrapped().it('filtered out', () => {});
      afterHooks(h.fake)[0]?.();
      enqueue(h.deps, 'fails');
      report(h.deps, 'fails', 'fail');

      assert.deepEqual(h.exits, [1]);
    });

    it('ends no file whose tests all passed before the grace ends', async () => {
      const h = installedHarness(fileEnv());
      await ranAndReported(h, 'passes', 'pass');
      afterHooks(h.fake)[0]?.();
      report(h.deps, 'passes', 'pass');

      assert.deepEqual(h.exits, []);
      assert.deepEqual(
        h.timers.map(({ ms }) => ms),
        [30_000],
      );
    });

    lzTestFor<readonly [string, string | undefined, number]>([
      ['the default of', undefined, 30_000],
      ['the default of, for 0,', '0', 30_000],
      ['250 ms, as set in', '250', 250],
    ])('waits %s the held-open variable', ([, heldOpen, ms]) => {
      const h = installedHarness({ ...fileEnv(), [envNames.heldOpen]: heldOpen });
      h.wrapped().it('passes', () => {});
      afterHooks(h.fake)[0]?.();

      assert.deepEqual(
        h.timers.map((timer) => timer.ms),
        [ms],
      );
    });

    lzTestFor<readonly [string, boolean, Record<string, unknown>]>([
      ['node:test reported every top-level test', true, { heldOpen: ['TCPServerWrap', 'PipeWrap'] }],
      ['a top-level test was not reported', false, { unfinished: true, heldOpen: ['TCPServerWrap', 'PipeWrap'] }],
    ])(
      "ends a file still alive when the grace ends with node:test's exit code, naming what its tests opened, when %s",
      async ([, reported, marks]) => {
        const h = installedHarness(fileEnv());
        h.wrapped().it('passes', () => {});
        enqueue(h.deps, 'passes');
        await bodyOf(h.fake.registrations, 'passes')(testContext());

        if (reported) {
          report(h.deps, 'passes', 'pass');
        }

        afterHooks(h.fake)[0]?.();
        h.listResources(['PipeWrap', 'TCPServerWrap', 'PipeWrap']);
        h.timers[0]?.fire();
        h.exit({ natural: false });

        assert.deepEqual(h.exits, [undefined]);
        assert.deepEqual(h.records[0]?.record, {
          main: true,
          tests: reported ? [{ id: `${testFile} > passes`, status: 'passed', timeSpentMs: 2 }] : [],
          ...marks,
          lifetime,
          testSpans: spans('passes'),
        });
      },
    );

    /** A file with one test that has started and not ended, whose event loop has emptied; `stall` sets its stall time. */
    function stalling(stall: number | undefined): Harness {
      const h = installedHarness({ ...fileEnv(), [envNames.stall]: stall === undefined ? undefined : String(stall) });
      h.wrapped().it('waits', () => {});
      enqueue(h.deps, 'waits');
      void bodyOf(h.fake.registrations, 'waits')(testContext());

      return h;
    }

    it('ends a file with exit code 1 when no test result follows its emptied event loop within the stall time', () => {
      const h = stalling(300);
      h.emptied();
      h.timers[0]?.fire();
      h.exit({ natural: false });

      assert.deepEqual(h.exits, [1]);
      assert.deepEqual(h.records[0]?.record, {
        main: true,
        tests: [],
        stalledMs: 300,
        lifetime,
        testSpans: spans('waits'),
      });
    });

    lzTestFor<readonly [string, (h: Harness) => void]>([
      [
        'a test result follows',
        (h) => {
          report(h.deps, 'waits', 'pass');
        },
      ],
      [
        'node:test reports its summary',
        (h) => {
          send(h.deps, { type: 'test:summary', data: { name: '', nesting: 0 } });
        },
      ],
    ])('keeps a file running when %s within the stall time', ([, then]) => {
      const h = stalling(300);
      h.emptied();
      then(h);

      assert.deepEqual(
        h.timers.map(({ ms }) => ms),
        [300],
      );

      h.timers[0]?.fire();

      assert.deepEqual(h.exits, []);
    });

    lzTestFor<readonly [string, number | undefined]>([
      ['without the stall variable, as in a dry run', undefined],
      ['for no stall time', 0],
      ['for a negative stall time', -1],
      ['for a stall time longer than a timer can hold', 2 ** 31],
      ['for a stall time that is not a whole number of milliseconds', 0.5],
    ])('waits for no stall %s', ([, stall]) => {
      const h = stalling(stall);
      h.emptied();

      assert.deepEqual(h.timers, []);
    });

    lzTestFor([1, 2 ** 31 - 1])('waits a stall time of %s ms, which a timer can hold', (stall) => {
      const h = stalling(stall);
      h.emptied();

      assert.deepEqual(
        h.timers.map(({ ms }) => ms),
        [stall],
      );
    });

    it('takes the stall variable out of the environment that the tests and the processes they start see', () => {
      const h = stalling(300);

      assert.equal(h.deps.env[envNames.stall], undefined);
    });

    it('names only what the tests opened, also when something the process had before is gone', () => {
      const h = installedHarness(fileEnv());
      h.wrapped().it('passes', () => {});
      afterHooks(h.fake)[0]?.();
      h.listResources(['TCPServerWrap', 'Timeout']);
      h.timers[0]?.fire();
      h.exit({ natural: false });

      assert.deepEqual(h.records[0]?.record.heldOpen, ['TCPServerWrap', 'Timeout']);
    });

    it("starts the grace once the test file's root `after` hooks have settled, also one added while they run", async () => {
      const h = installedHarness(fileEnv());
      const { promise: firstSettles, resolve: resolveFirst }: PromiseWithResolvers<void> = Promise.withResolvers();
      h.wrapped().after(() => firstSettles);
      h.wrapped().after(() => {});
      const [finished, first, second] = afterHooks(h.fake);
      await ranAndReported(h, 'fails', 'fail');

      finished?.();
      const firstDone: unknown = first?.();
      h.wrapped().after(() => {});
      const [, , , added] = afterHooks(h.fake);
      resolveFirst();
      await firstDone;
      await second?.();

      assert.deepEqual([h.timers.length, h.exits], [0, []]);

      await added?.();

      assert.deepEqual([h.timers.length, h.exits], [1, [1]]);
    });

    lzTestFor<readonly [string, (context?: unknown, done?: unknown) => unknown]>([
      [
        'throws',
        (): unknown => {
          throw new Error('after failed');
        },
      ],
      [
        'takes `done` and throws',
        (_context: unknown, _done: unknown): unknown => {
          throw new Error('after failed');
        },
      ],
      ['rejects', (): unknown => Promise.reject(new Error('after failed'))],
    ])('stops waiting at a root `after` hook that %s, as node:test runs none after it', async ([, hook]) => {
      const h = installedHarness(fileEnv());
      h.wrapped().after(hook);
      h.wrapped().after(() => {});
      const [finished, failing] = afterHooks(h.fake);

      finished?.();
      await assert.rejects(
        async () => {
          await failing?.();
        },
        { message: 'after failed' },
      );

      assert.equal(h.timers.length, 1);
    });

    lzTestFor([
      ['with no error, once it calls back', undefined],
      ['with an error, stopping the wait', new Error('after failed')],
    ])('passes a callback hook its `done` and settles %s', ([, error]) => {
      const h = installedHarness(fileEnv());
      const passed: unknown[] = [];
      let callBack = () => {};
      h.wrapped().after((_context: unknown, done: (error?: unknown) => void) => {
        callBack = () => {
          done(error);
        };
      });
      h.wrapped().after(() => {});
      const [finished, callbackHook] = afterHooks(h.fake);

      assert.equal(callbackHook?.length, 2);

      finished?.();
      callbackHook({}, (given: unknown) => passed.push(given));

      assert.equal(h.timers.length, 0);

      callBack();

      assert.deepEqual([h.timers.length, passed], [error ? 1 : 0, [error]]);
    });

    it('starts the grace only once its own root `after` hook has run, as one added inside another hook runs earlier', async () => {
      const h = installedHarness(fileEnv());
      h.wrapped().after(() => {});
      const [finished, early] = afterHooks(h.fake);
      await early?.();

      assert.equal(h.timers.length, 0);

      finished?.();

      assert.equal(h.timers.length, 1);
    });

    const fileFailure: TestEvent = {
      type: 'test:fail',
      data: { name: testFile, nesting: 0, details: { duration_ms: 1 } },
    };

    lzTestFor<readonly [string, string, TestEvent, number]>([
      ['starts', 'node:test reports the file failed once the tests finished', fileFailure, 1],
      [
        'does not start',
        'a nested failure has no type',
        { ...fileFailure, data: { ...fileFailure.data, nesting: 1 } },
        0,
      ],
      ['does not start', 'the file passed', { ...fileFailure, type: 'test:pass' }, 0],
      [
        'does not start',
        'a top-level test failed',
        { ...fileFailure, data: { ...fileFailure.data, details: { type: 'test', duration_ms: 1 } } },
        0,
      ],
    ])(
      '%s the grace at a root `after` hook that never settles when %s, as node:test times out such a hook',
      ([, , event, timers]) => {
        const h = installedHarness(fileEnv());
        h.wrapped().after(() => new Promise(() => {}));
        const [finished] = afterHooks(h.fake);

        finished?.();
        send(h.deps, event);

        assert.equal(h.timers.length, timers);
      },
    );

    it('does not start the grace at a root `after` hook that never settles when node:test reports the file failed before the tests finished, as node:test times out such a hook', () => {
      const h = installedHarness(fileEnv());
      h.wrapped().after(() => new Promise(() => {}));
      const [finished] = afterHooks(h.fake);

      send(h.deps, fileFailure);
      finished?.();

      assert.equal(h.timers.length, 0);
    });

    it('starts the grace once, whatever settles after it started', async () => {
      const h = installedHarness(fileEnv());
      h.wrapped().after(() => {
        throw new Error('after failed');
      });
      h.wrapped().after(() => {});
      const [finished, failing, later] = afterHooks(h.fake);

      finished?.();
      const thrown = failing?.();
      assert.ok(thrown instanceof Promise);
      await assert.rejects(thrown, { message: 'after failed' });
      later?.();
      finished?.();

      assert.equal(h.timers.length, 1);
    });

    it('waits for no `after` hook of a suite, nor one registered without a function', () => {
      const h = installedHarness(fileEnv());
      h.wrapped().describe('suite', () => {
        h.wrapped().after(() => {});
      });
      h.wrapped().after();
      afterHooks(h.fake)[0]?.();

      assert.equal(h.timers.length, 1);
    });
  });

  it("writes when the hook ran and when it wrote, and in the test file's record each test's spans", async () => {
    let time = 10;
    const now = () => ++time;
    const descendant = installedHarness({ [envNames.out]: out }, { now });
    const main = installedHarness(fileEnv(), { now });

    await ranAndReported(main, 'runs', 'pass');
    main.exit();
    descendant.exit();

    assert.deepEqual(
      [main, descendant].map(({ records }) => [records[0]?.record.lifetime, records[0]?.record.testSpans]),
      [
        [{ start: 12, end: 15 }, { [`${testFile} > runs`]: [{ start: 13, end: 14 }] }],
        [{ start: 11, end: 16 }, undefined],
      ],
    );
  });

  it('ends the span of a test that runs as the record is written at the time it is written', async () => {
    let time = 10;
    const main = installedHarness(fileEnv(), { now: () => ++time });
    main.wrapped().it('exits', () => {
      main.exit({ natural: false });
    });

    await bodyOf(main.fake.registrations, 'exits')(testContext());

    assert.deepEqual(
      [main.records[0]?.record.lifetime, main.records[0]?.record.testSpans],
      [{ start: 11, end: 13 }, { [`${testFile} > exits`]: [{ start: 12, end: 13 }] }],
    );
  });

  it('writes the hit count and, only in the dry run, the mutant coverage and the peak memory', () => {
    const coverage = { static: { 1: 2 }, perTest: { [`${testFile} > t`]: { 3: 1 } } };
    const written = ['true', 'false', undefined].map((dryRun) => {
      const { deps, records, exit } = installedHarness({
        [envNames.out]: out,
        [envNames.dryRun]: dryRun,
        [envNames.hitLimit]: '9',
      });
      const ns = deps.global.__stryker__;

      if (ns === undefined) {
        throw new Error('install set no __stryker__ namespace.');
      }

      ns.mutantCoverage = coverage;
      ns.hitCount = 7;
      exit();

      return records[0]?.record;
    });

    assert.deepEqual(written, [
      { tests: [], hitCount: 7, mutantCoverage: coverage, peakMemoryMB: 123, lifetime },
      { tests: [], hitCount: 7, lifetime },
      { tests: [], hitCount: 7, lifetime },
    ]);
  });
});

describe('passing `done` as node:test does', () => {
  /** node:test passes a `done` callback only to a function whose length is exactly 2. */
  const callAsNodeTest = (fn: Fn | undefined, context: unknown): unknown => {
    assert.ok(fn);

    return fn.length === 2 ? fn(context, () => {}) : fn(context);
  };
  const threeParameters = (seen: unknown[]) => (_context: unknown, done: unknown, _extra: unknown) => {
    seen.push(done);
  };

  it('passes no `done` to a root `after` hook with three parameters', async () => {
    const h = installedHarness(fileEnv());
    const seen: unknown[] = [];
    h.wrapped().after(threeParameters(seen));

    await callAsNodeTest(afterHooks(h.fake)[1], {});

    assert.deepEqual(seen, [undefined]);
  });

  it('passes no `done` to a beforeEach hook with three parameters that runs for a test', async () => {
    const h = installedHarness(fileEnv());
    const seen: unknown[] = [];
    h.wrapped().beforeEach(threeParameters(seen));
    h.wrapped().it('first', () => {});
    const [hook] = hooksOf(h.fake.registrations, 'beforeEach');

    await callAsNodeTest(hook, testContext([], 'first'));

    assert.deepEqual(seen, [undefined]);
  });

  it('passes no `done` to a test body with three parameters', async () => {
    const h = installedHarness(fileEnv());
    const seen: unknown[] = [];
    h.wrapped().it('three', threeParameters(seen));

    await callAsNodeTest(rawBodyOf(h.fake.registrations, 'three'), testContext());

    assert.deepEqual(seen, [undefined]);
  });
});
