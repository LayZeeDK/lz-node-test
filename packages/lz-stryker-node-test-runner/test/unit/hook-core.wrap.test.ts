import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { InstrumenterContext, Position } from '@stryker-mutator/api/core';

import { lzTestEach } from '@layzee/lz-node-test';
import { activeMutantEnv, envNames, wrapNodeTest, type CallSite, type RecordedTest } from '../../src/hook-core.ts';
import {
  bodyOf,
  callable,
  fakeNodeTest,
  rawBodyOf,
  runBodies,
  testFile,
  testContext,
  type Fn,
} from '../hook-core.fixtures.ts';
import { callMember, member } from '../index.fixtures.ts';

interface Subtests {
  readonly test: (name: string, body: Fn) => unknown;
}

interface SuiteCall {
  readonly self: unknown;
  readonly args: readonly unknown[];
}

function wrapped(filter?: string[], bail = false, activeMutant?: string) {
  const fake = fakeNodeTest();
  const ns: InstrumenterContext = {};
  const env: Record<string, string | undefined> = {};
  const tests: RecordedTest[] = [];
  const seen: (string | undefined)[] = [];
  const positions = new Map<string, Position>();
  const sites: CallSite[] = [];
  /** Each call of `registering`: whether top-level, and how many registrations node:test had then. */
  const registering: [boolean, number][] = [];
  const rootAfters: unknown[] = [];
  const module = wrapNodeTest({
    ns,
    testFile: testFile,
    tests,
    filter: filter && new Set(filter),
    bail,
    activeMutant,
    env,
    positions,
    callSites: () => sites,
    nodeTest: fake.module,
    registering: (topLevel) => {
      registering.push([topLevel, fake.registrations.length]);
    },
    rootAfter: (hook) => {
      rootAfters.push(hook);

      return hook;
    },
  });

  const see = () => seen.push(ns.currentTestId);

  return {
    ...fake,
    original: fake.module,
    module,
    ns,
    env,
    tests,
    positions,
    sites,
    seen,
    see,
    registering,
    rootAfters,
  };
}

describe('wrapNodeTest', () => {
  it('names tests after the file, the enclosing suites, and the test, for every node:test function', async () => {
    const { module, registrations, seen, see } = wrapped();
    module.describe('outer', () => {
      module.suite('inner', () => {
        module.it('first', see);
      });
      module.test('second', see);
    });
    module.suite('sibling', () => {
      module.it('third', see);
    });
    module.test('top', see);

    await runBodies(registrations, ['first', 'second', 'third', 'top']);

    assert.deepEqual(seen, [
      `${testFile} > outer > inner > first`,
      `${testFile} > outer > second`,
      `${testFile} > sibling > third`,
      `${testFile} > top`,
    ]);
  });

  it('tells same-named suites and tests of one parent apart in the order they are declared', async () => {
    const { module, registrations, positions, sites, seen, see } = wrapped();
    sites.push({ file: testFile, line: 1, column: 1 });
    module.describe('s', () => {
      module.it('works', see);
      module.it.skip('works', see);
      module.test('works', async (t: Subtests) => {
        t.test('child', see);
        t.test('child', see);
      });
    });
    module.describe('s', () => {
      module.it('works', see);
    });

    const run = (kind: string, name: string, nth: number, context = testContext()) => {
      const registration = registrations.filter((candidate) => candidate.kind === kind && candidate.name === name)[nth];

      return callable(registration?.rest.find((arg) => typeof arg === 'function'))(context);
    };

    await run('test', 'works', 0);
    await run('test', 'works', 1, testContext(registrations));
    await run('test', 'works', 2);
    await run('t.test', 'child', 0);
    await run('t.test', 'child', 1);

    assert.deepEqual(seen, [
      `${testFile} > s > works`,
      `${testFile} > s (2) > works`,
      `${testFile} > s > works (3) > child`,
      `${testFile} > s > works (3) > child (2)`,
    ]);
    assert.deepEqual(
      [...positions.keys()],
      [
        `${testFile} > s`,
        `${testFile} > s > works`,
        `${testFile} > s > works (2)`,
        `${testFile} > s > works (3)`,
        `${testFile} > s (2)`,
        `${testFile} > s (2) > works`,
        `${testFile} > s > works (3) > child`,
        `${testFile} > s > works (3) > child (2)`,
      ],
    );
  });

  it('leaves the suite after a suite body throws', async () => {
    const { module, registrations, suiteResults, seen, see } = wrapped();
    const failure = new Error('broken suite');
    module.describe('broken', () => {
      throw failure;
    });
    module.it('after', see);

    await bodyOf(registrations, 'after')(testContext());

    assert.equal(suiteResults[0], failure);
    assert.deepEqual(seen, [`${testFile} > after`]);
  });

  it('passes name, options, receiver and return values through, with tests inside run one at a time', async () => {
    const { module, registrations, suiteResults } = wrapped();
    const options = { timeout: 1000, concurrency: true };
    let suiteCall: SuiteCall | undefined;
    let testCall: SuiteCall | undefined;

    const suiteReturn = module.describe.call(
      'describe this',
      'suite',
      options,
      function (this: unknown, ...args: unknown[]) {
        suiteCall = { self: this, args };

        return 'suite body result';
      },
    );
    const testReturn = module.it.call('it this', 'case', options, function (this: unknown, ...args: unknown[]) {
      testCall = { self: this, args };

      return 'test body result';
    });

    assert.equal(suiteReturn, 'describe suite');
    assert.equal(testReturn, 'test case');
    const serial = { ...options, concurrency: false };
    assert.deepEqual(
      registrations.map(({ kind, name, rest, self }) => ({ kind, name, options: rest[0], self, count: rest.length })),
      [
        { kind: 'describe', name: 'suite', options: serial, self: 'describe this', count: 2 },
        { kind: 'test', name: 'case', options: serial, self: 'it this', count: 2 },
      ],
    );
    assert.deepEqual(suiteCall, { self: 'suite this', args: ['suite argument'] });
    assert.equal(suiteResults[0], 'suite body result');

    const context = testContext();
    const result = await bodyOf(registrations, 'case').call('test this', context, 'second argument');

    assert.deepEqual(testCall, { self: 'test this', args: [context, 'second argument'] });
    assert.equal(result, 'test body result');
    assert.deepEqual(options, { timeout: 1000, concurrency: true });
  });

  it('registers tests and suites without a body', () => {
    const { module, registrations } = wrapped();
    module.describe('empty suite');
    module.it('empty test', { timeout: 5 });

    assert.deepEqual(
      registrations.map(({ name, rest }) => ({ name, rest })),
      [
        { name: 'empty suite', rest: [{ concurrency: false }] },
        { name: 'empty test', rest: [{ timeout: 5, concurrency: false }] },
      ],
    );
  });

  it('names suites and tests without a name, or with options first, after their bodies, like node:test', async () => {
    const { module, registrations, seen, see } = wrapped();
    const call = (register: unknown, ...args: unknown[]) => callable(register)(...args);
    call(module.describe, '', () => {
      call(module.it, () => see());
    });
    call(module.test, { timeout: 1 }, function optionsFirst() {
      see();
    });
    call(module.it, function nameOnly() {
      see();
    });

    for (const registration of registrations.filter(({ kind }) => kind !== 'describe')) {
      await callable(registration.rest.find((arg) => typeof arg === 'function'))(testContext());
    }

    assert.deepEqual(
      registrations.map(({ name, rest }) => [name, rest[0]]),
      [
        ['<anonymous>', { concurrency: false }],
        ['<anonymous>', { concurrency: false }],
        ['optionsFirst', { timeout: 1, concurrency: false }],
        ['nameOnly', { concurrency: false }],
      ],
    );
    assert.deepEqual(seen, [
      `${testFile} > <anonymous> > <anonymous>`,
      `${testFile} > optionsFirst`,
      `${testFile} > nameOnly`,
    ]);
  });

  lzTestEach<'describe' | 'suite' | 'test'>(['describe', 'suite', 'test'])(
    "keeps the other properties of node:test's %s",
    (kind) => {
      const { module } = wrapped();

      assert.equal(member(module[kind], 'mock'), `${kind}.mock`);
    },
  );

  it('keeps the other properties of the node:test module', () => {
    const { module } = wrapped();

    assert.equal(member(module, 'run'), 'run');
  });

  it('wraps the module, which is the test function, in a copy and leaves node:test unchanged', async () => {
    const { module, original, registrations, seen, see } = wrapped();
    const unwrapped = { ...original };
    module('default export', see);
    module.only('default export only', see);

    await runBodies(registrations, ['default export', 'default export only']);

    assert.deepEqual(seen, [`${testFile} > default export`, `${testFile} > default export only`]);
    assert.equal(module.test, module);
    assert.notEqual(module, original);
    assert.deepEqual({ ...original }, unwrapped);
  });

  it('names the tests of only and todo suites and shorthands after their suites', async () => {
    const { module, registrations, seen, see } = wrapped();
    module.describe.only('describe.only', () => {
      module.it('first', see);
      module.it.only('it.only', see);
    });
    module.suite.only('suite.only', () => {
      module.test.only('test.only', see);
    });
    module.describe.todo('describe.todo', () => {
      module.it.todo('it.todo', see);
    });
    module.suite.todo('suite.todo', () => {
      module.test.todo('test.todo', see);
    });

    await runBodies(registrations, ['first', 'it.only', 'test.only', 'it.todo', 'test.todo']);

    assert.deepEqual(seen, [
      `${testFile} > describe.only > first`,
      `${testFile} > describe.only > it.only`,
      `${testFile} > suite.only > test.only`,
      `${testFile} > describe.todo > it.todo`,
      `${testFile} > suite.todo > test.todo`,
    ]);
    assert.deepEqual(
      registrations.map(({ kind, name }) => `${kind} ${name}`),
      [
        'describe.only describe.only',
        'test first',
        'test.only it.only',
        'suite.only suite.only',
        'test.only test.only',
        'describe.todo describe.todo',
        'test.todo it.todo',
        'suite.todo suite.todo',
        'test.todo test.todo',
      ],
    );
  });

  it('names subtests after the test that registers them, which is current again once they end', async () => {
    const { module, registrations, ns, env, seen, see } = wrapped();
    const context = testContext(registrations);
    const childContext = testContext(registrations);
    module.describe('suite', () => {
      module.it('parent', async (t: Subtests) => {
        see();
        assert.equal(t.test('child', see), 't.test child');
        await bodyOf(registrations, 'child')(childContext);
        see();
      });
    });
    module.test('calls back', (t: Subtests, done: () => void) => {
      t.test('callback child', see);
      done();
    });

    await bodyOf(registrations, 'parent')(context);
    childContext.test('grandchild', see);
    await bodyOf(registrations, 'grandchild')(testContext());
    const callbackContext = testContext(registrations);
    rawBodyOf(registrations, 'calls back')(callbackContext, () => {});
    await bodyOf(registrations, 'callback child')(testContext());
    await callbackContext.end();

    assert.deepEqual(seen, [
      `${testFile} > suite > parent`,
      `${testFile} > suite > parent > child`,
      `${testFile} > suite > parent`,
      `${testFile} > suite > parent > child > grandchild`,
      `${testFile} > calls back > callback child`,
    ]);
    assert.deepEqual(
      registrations.filter(({ kind }) => kind === 't.test').map(({ name, self }) => [name, self]),
      [
        ['child', context],
        ['grandchild', childContext],
        ['callback child', callbackContext],
      ],
    );
    assert.equal(ns.currentTestId, undefined);
    assert.ok(!(envNames.current in env));
  });

  it('keeps a subtest that its parent does not await current until it ends, after its parent ends', async () => {
    const { module, registrations, ns, env, seen, see } = wrapped();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let child: Promise<unknown> | undefined;
    module.it('parent', (t: Subtests) => {
      t.test('child', async () => {
        await gate;
        see();
      });
      child = bodyOf(registrations, 'child')(testContext());
    });
    module.describe('suite', () => {
      see();
    });

    await bodyOf(registrations, 'parent')(testContext(registrations));
    see();
    release();
    await child;

    const childId = `${testFile} > parent > child`;
    assert.deepEqual(seen, [undefined, childId, childId]);
    assert.equal(ns.currentTestId, undefined);
    assert.ok(!(envNames.current in env));
  });

  it('names the suites and tests a running test registers with the module after it, as node:test nests them', async () => {
    const { module, registrations, seen, see } = wrapped();
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    module.it('parent', async (t: Subtests) => {
      module.it('inner', see);
      module.describe('suite', () => {
        module.it('in suite', see);
      });
      t.test('child', tick);
      // node:test starts a subtest at once; its parent goes on while it waits.
      const child = bodyOf(registrations, 'child')(testContext());
      module.test('while a subtest runs', see);
      await child;
      await tick();
      module.it('after an await', see);
    });

    await bodyOf(registrations, 'parent')(testContext(registrations));

    await runBodies(registrations, ['inner', 'in suite', 'while a subtest runs', 'after an await']);

    assert.deepEqual(seen, [
      `${testFile} > parent > inner`,
      `${testFile} > parent > suite > in suite`,
      `${testFile} > parent > while a subtest runs`,
      `${testFile} > parent > after an await`,
    ]);
  });

  it('runs a test whose subtest the filter selects, and skips the subtests it does not select', async () => {
    const { module, registrations, seen, see } = wrapped([`${testFile} > parent > wanted`]);
    module.it('parent', async (t: Subtests) => {
      see();
      t.test('wanted', see);
      t.test('unwanted', see);
      await bodyOf(registrations, 'wanted')(testContext());
    });
    module.it('paren', see);

    await bodyOf(registrations, 'parent')(testContext(registrations));

    assert.deepEqual(
      registrations.map(({ name, rest }) => [name, member(rest[0], 'skip')]),
      [
        ['parent', undefined],
        ['paren', true],
        ['wanted', undefined],
        ['unwanted', true],
      ],
    );
    assert.deepEqual(seen, [`${testFile} > parent`, `${testFile} > parent > wanted`]);
  });

  it('tells before each suite, test and hook goes to node:test, and whether it is a top-level suite or test', async () => {
    const { module, registrations, registering } = wrapped([`${testFile} > runs`]);
    module.after(() => {});
    module.describe('suite', () => {
      module.it('nested', () => {});
      module.it.skip('nested skipped');
    });
    module.it.skip('skipped');
    module.it('runs', async (t: Subtests) => {
      module.it('registered while it runs', () => {});
      await t.test('subtest', () => {});
    });
    module.it('filtered out', () => {});
    await bodyOf(registrations, 'runs')(testContext(registrations));

    // The hook, the suite, its two tests, the skipped test, `runs`, the filtered test, and the two that `runs` registers.
    assert.deepEqual(registering, [
      [false, 0],
      [true, 1],
      [false, 2],
      [false, 3],
      [true, 4],
      [true, 5],
      [true, 6],
      [false, 7],
      [false, 8],
    ]);
  });

  it('hands each root `after` hook with a function, and none other, to rootAfter, and registers what it returns', () => {
    const { module, registrations, rootAfters } = wrapped();
    const root = () => {};
    module.after(root);
    module.after();
    module.describe('suite', () => {
      module.after(() => {});
    });

    assert.equal(rootAfters.length, 1);
    assert.deepEqual(
      registrations.filter(({ kind }) => kind === 'after').map(({ rest }) => rest[0] === rootAfters[0]),
      [true, false, false],
    );
  });

  it('wraps expectFailure on Node.js 24, where tests have it', async () => {
    const { module, registrations, seen, see } = wrapped();
    module.it.expectFailure?.('it.expectFailure', see);
    module.test.expectFailure?.('test.expectFailure', see);

    await runBodies(registrations, ['it.expectFailure', 'test.expectFailure']);

    assert.deepEqual(seen, [`${testFile} > it.expectFailure`, `${testFile} > test.expectFailure`]);
    assert.equal(module.describe.expectFailure, undefined);

    const node22 = wrapNodeTest({
      ns: {},
      testFile: testFile,
      tests: [],
      filter: undefined,
      bail: false,
      activeMutant: undefined,
      env: {},
      positions: new Map(),
      callSites: () => [],
      nodeTest: fakeNodeTest(false).module,
      registering: () => {},
      rootAfter: (hook) => hook,
    });

    assert.deepEqual([node22.it.expectFailure, node22.expectFailure], [undefined, undefined]);
  });

  it('notes where the test file declares each suite and test, 0-based, from the innermost call in the test file', () => {
    const { module, positions, sites, registrations } = wrapped();
    const helper = join('/repo', 'helper.ts');
    sites.push({ file: helper, line: 2, column: 3 }, { file: testFile, line: 8, column: 5 });
    sites.push({ file: testFile, line: 20, column: 1 });
    module.it('through a helper', () => {});
    sites.splice(0, Infinity, { file: testFile, line: 1, column: 1 });
    module.describe('suite', () => {
      module.test('directly', (t: { test: (name: string) => unknown }) => t.test('subtest'));
    });
    void bodyOf(registrations, 'directly')(testContext());
    sites.splice(0, Infinity, { file: helper, line: 4, column: 1 });
    module.it('only in a helper', () => {});

    assert.deepEqual(Object.fromEntries(positions), {
      [`${testFile} > through a helper`]: { line: 7, column: 4 },
      [`${testFile} > suite`]: { line: 0, column: 0 },
      [`${testFile} > suite > directly`]: { line: 0, column: 0 },
      [`${testFile} > suite > directly > subtest`]: { line: 0, column: 0 },
    });
  });

  it('notes where skipped suites and tests are declared, and registers them with their own arguments', () => {
    const { module, positions, sites, registrations } = wrapped();
    const body = () => {};
    const options = { timeout: 5 };
    sites.push({ file: testFile, line: 3, column: 4 });
    module.describe('suite', () => {
      module.it.skip('nested', options, body);
    });
    module.test.skip('test', body);
    module.describe.skip('describe', body);
    module.suite.skip.call('suite this', 'skipped suite', body);

    assert.deepEqual(Object.fromEntries(positions), {
      [`${testFile} > suite`]: { line: 2, column: 3 },
      [`${testFile} > suite > nested`]: { line: 2, column: 3 },
      [`${testFile} > test`]: { line: 2, column: 3 },
      [`${testFile} > describe`]: { line: 2, column: 3 },
      [`${testFile} > skipped suite`]: { line: 2, column: 3 },
    });
    assert.deepEqual(registrations.slice(1), [
      { kind: 'test.skip', name: 'nested', rest: [options, body], self: module.it },
      { kind: 'test.skip', name: 'test', rest: [body], self: module.test },
      { kind: 'describe.skip', name: 'describe', rest: [body], self: module.describe },
      { kind: 'suite.skip', name: 'skipped suite', rest: [body], self: 'suite this' },
    ]);
  });

  it('rethrows what a test body throws or rejects with', async () => {
    const { module, registrations } = wrapped();
    const failure = new Error('expected 1 to be 2');
    module.it('fails', () => {
      throw failure;
    });
    module.it('rejects with 0', async () => {
      throw 0;
    });

    await assert.rejects(bodyOf(registrations, 'fails')(testContext()), (error) => error === failure);
    await assert.rejects(bodyOf(registrations, 'rejects with 0')(testContext()), (error) => error === 0);
  });

  describe('callback-style tests', () => {
    it('declares `done`, so node:test passes it, and keeps the test current until `done` is called and its after hooks ran', async () => {
      const { module, registrations, ns, env } = wrapped();
      const context = testContext();
      const seen: unknown[] = [];
      let finish: ((error?: unknown) => void) | undefined;
      module.it('calls back', function (this: unknown, t: unknown, done: (error?: unknown) => void) {
        seen.push(this, t);
        finish = done;
      });
      const body = rawBodyOf(registrations, 'calls back');
      const receiver = {};
      const calls: unknown[][] = [];

      assert.equal(body.length, 2);

      body.call(receiver, context, (...args: unknown[]) => calls.push(args));

      assert.deepEqual(seen, [receiver, context]);
      assert.deepEqual(
        [ns.currentTestId, env[envNames.current]],
        [`${testFile} > calls back`, `${testFile} > calls back`],
      );
      assert.deepEqual(calls, []);

      await context.end();

      assert.equal(ns.currentTestId, `${testFile} > calls back`);

      finish?.();

      assert.deepEqual(calls, [[undefined]]);
      assert.equal(ns.currentTestId, undefined);
      assert.ok(!(envNames.current in env));
      assert.equal(context.skipped, false);
    });

    it('passes the error given to `done` on', () => {
      const { module, registrations } = wrapped();
      const failure = new Error('called back with an error');
      module.it('fails', (_t: unknown, done: (error?: unknown) => void) => done(failure));
      const calls: unknown[][] = [];

      rawBodyOf(registrations, 'fails')(testContext(), (...args: unknown[]) => calls.push(args));

      assert.deepEqual(calls, [[failure]]);
    });

    it('rethrows a synchronous throw and leaves the test once its after hooks ran', async () => {
      const { module, registrations, ns } = wrapped();
      const context = testContext();
      module.it('throws', (_t: unknown, _done: unknown) => {
        throw 0;
      });

      assert.throws(
        () => rawBodyOf(registrations, 'throws')(context, () => {}),
        (error) => error === 0,
      );

      assert.equal(ns.currentTestId, `${testFile} > throws`);

      await context.end();

      assert.equal(ns.currentTestId, undefined);
    });

    it('leaves the test once when it calls `done` and then throws, so its parent stays current', async () => {
      const { module, registrations, seen, see } = wrapped();
      module.it('parent', async (t: Subtests) => {
        t.test('child', (_t: unknown, done: unknown) => {
          callable(done)();
          throw 0;
        });
        assert.throws(
          () => rawBodyOf(registrations, 'child')(testContext(), () => {}),
          (error) => error === 0,
        );
        see();
      });

      await bodyOf(registrations, 'parent')(testContext(registrations));

      assert.deepEqual(seen, [`${testFile} > parent`]);
    });
  });

  it('sets the current test id in the namespace and the environment while the test runs', async () => {
    const { module, registrations, ns, env } = wrapped();
    const seen: unknown[] = [];
    module.it('observes', () => {
      seen.push(ns.currentTestId, env[envNames.current]);
    });

    await bodyOf(registrations, 'observes')(testContext());

    assert.deepEqual(seen, [`${testFile} > observes`, `${testFile} > observes`]);
  });

  it('activates the runtime mutant when a test starts and keeps it active, also for processes it starts', async () => {
    const { module, registrations, ns, env } = wrapped(undefined, false, '7');
    const seen: unknown[] = [];
    module.it('first', () => {
      seen.push(ns.activeMutant, env[activeMutantEnv]);
    });
    module.it('second', (_t: unknown, done: () => void) => {
      seen.push(ns.activeMutant);
      done();
    });

    assert.deepEqual([ns.activeMutant, env[activeMutantEnv]], [undefined, undefined]);

    await bodyOf(registrations, 'first')(testContext());

    assert.deepEqual([ns.activeMutant, env[activeMutantEnv]], ['7', '7']);

    delete ns.activeMutant;
    await bodyOf(registrations, 'second')(testContext(), () => {});

    assert.deepEqual(seen, ['7', '7', '7']);
  });

  it('activates the runtime mutant before beforeEach hooks and the before hooks of suites run', () => {
    const { module, registrations, ns, env } = wrapped(undefined, false, '7');
    const seen: unknown[] = [];
    const observe = function (this: unknown, ...args: unknown[]) {
      seen.push(ns.activeMutant, env[activeMutantEnv], this, args);

      return 'hook result';
    };
    const withDone = (_t: unknown, done: unknown) => callable(done)();
    const topLevelBefore = () => {};
    module.before(topLevelBefore, { timeout: 5 });
    module.beforeEach(observe, { timeout: 6 });
    module.beforeEach(withDone);
    module.describe('suite', () => {
      module.before(observe);
    });
    const hooks = registrations.filter(({ kind }) => kind !== 'describe').map(({ kind, rest }) => ({ kind, rest }));

    assert.deepEqual(
      hooks.map(({ kind, rest }) => [kind, rest.slice(1), member(rest[0], 'length')]),
      [
        ['before', [{ timeout: 5 }], 0],
        ['beforeEach', [{ timeout: 6 }], 0],
        ['beforeEach', [], 2],
        ['before', [], 0],
      ],
    );
    assert.equal(hooks[0]?.rest[0], topLevelBefore);
    assert.deepEqual([ns.activeMutant, env[activeMutantEnv]], [undefined, undefined]);

    const results = [];

    for (const index of [1, 3]) {
      results.push(callable(hooks[index]?.rest[0]).call('hook this', 'context'));
      delete ns.activeMutant;
    }

    assert.deepEqual(results, ['hook result', 'hook result']);
    assert.deepEqual(seen, ['7', '7', 'hook this', ['context'], '7', '7', 'hook this', ['context']]);
  });

  describe('hooks', () => {
    function hooksOf(registrations: { kind: string; rest: readonly unknown[] }[], kind: string): Fn[] {
      return registrations.filter((registration) => registration.kind === kind).map(({ rest }) => callable(rest[0]));
    }

    it('makes the test that a beforeEach hook runs for current until its promise settles or it calls `done`', async () => {
      const { module, registrations, ns, seen, see } = wrapped();
      const failure = new Error('hook failed');
      let finish: (error?: unknown) => void = () => {};
      const received: unknown[][] = [];
      module.beforeEach(async (...args: unknown[]) => {
        received.push(args);
        see();
        await Promise.resolve();
        see();

        return 'promised';
      });
      module.beforeEach((_t: unknown, done: unknown) => {
        see();
        finish = callable(done);

        return 'called back';
      });
      module.beforeEach(() => {
        see();
        throw failure;
      });
      module.it('first', see);
      module.describe('suite', () => {
        module.it('second', see);
      });
      const [promised, callback, throwing] = hooksOf(registrations, 'beforeEach');
      assert.ok(promised);
      assert.ok(callback);
      assert.ok(throwing);
      const calls: unknown[][] = [];

      const context = testContext([], 'suite > second');
      const settled = promised(context);

      assert.deepEqual(received, [[context]]);
      assert.equal(ns.currentTestId, `${testFile} > suite > second`);
      assert.equal(await settled, 'promised');
      assert.equal(ns.currentTestId, undefined);
      assert.equal(
        callback(testContext([], 'first'), (...args: unknown[]) => calls.push(args)),
        'called back',
      );
      assert.equal(ns.currentTestId, `${testFile} > first`);

      finish(failure);

      assert.deepEqual(calls, [[failure]]);
      assert.equal(ns.currentTestId, undefined);
      assert.throws(() => throwing(testContext([], 'first')), failure);
      assert.equal(ns.currentTestId, undefined);
      assert.deepEqual(seen, [
        `${testFile} > suite > second`,
        `${testFile} > suite > second`,
        `${testFile} > first`,
        `${testFile} > first`,
      ]);
    });

    it('leaves the hooks of a suite, of a name several tests share, and of no test as they are', () => {
      const { module, registrations, ns, env, seen } = wrapped();
      const hook = (..._args: unknown[]) => {
        seen.push(ns.currentTestId);

        return 'hook result';
      };
      module.beforeEach(hook);
      module.after(hook);
      module.describe('suite', () => {
        module.it('inner', () => {});
      });
      module.it('same', () => {});
      module.it('same', () => {});

      const results = [];

      for (const registered of [...hooksOf(registrations, 'beforeEach'), ...hooksOf(registrations, 'after')]) {
        for (const context of [
          testContext([], 'suite'),
          testContext([], 'same'),
          testContext([], 'inner'),
          undefined,
        ]) {
          results.push(registered(context));
        }
      }

      assert.deepEqual(
        results,
        Array.from({ length: 8 }, () => 'hook result'),
      );
      assert.deepEqual(
        seen,
        Array.from({ length: 8 }, () => undefined),
      );
      assert.ok(!(envNames.current in env));
    });

    it('keeps a test current after its body until its after hooks run, and through them while its body runs', async () => {
      const { module, registrations, ns, seen, see } = wrapped();
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      module.it('waits', async (t: { after: (hook: Fn) => void }) => {
        t.after(see);
        await gate;
      });
      module.it('returns', () => {});
      const waits = testContext([], 'waits');
      const returns = testContext([], 'returns');

      const running = rawBodyOf(registrations, 'waits')(waits);
      await waits.end();

      assert.equal(ns.currentTestId, `${testFile} > waits`);

      release();
      await running;

      assert.equal(ns.currentTestId, undefined);

      await rawBodyOf(registrations, 'returns')(returns);

      assert.equal(ns.currentTestId, `${testFile} > returns`);

      await returns.end();

      assert.equal(ns.currentTestId, undefined);
      assert.deepEqual(seen, [`${testFile} > waits`]);
    });

    it("makes a test current while the hooks it registers run: after hooks, and subtests' beforeEach hooks", async () => {
      const { module, registrations, ns, seen, see } = wrapped();
      let context: unknown;
      module.it('parent', (t: Subtests & { after: (hook: Fn) => void; beforeEach: (...args: unknown[]) => void }) => {
        context = t;
        t.after(async () => {
          see();
          await Promise.resolve();
          see();
        });
        module.after(see);
        t.beforeEach(see, { timeout: 5 });
        t.test('child', () => {});
      });

      await bodyOf(registrations, 'parent')(testContext(registrations, 'parent'));
      const [beforeEach] = registrations.filter(({ kind }) => kind === 't.beforeEach');
      await callable(beforeEach?.rest[0])(testContext([], 'parent > child'));
      await hooksOf(registrations, 'after')[0]?.(testContext([], 'parent'));

      assert.deepEqual([beforeEach?.self, beforeEach?.rest[1]], [context, { timeout: 5 }]);
      assert.equal(ns.currentTestId, undefined);
      assert.deepEqual(seen, [
        `${testFile} > parent`,
        `${testFile} > parent`,
        `${testFile} > parent > child`,
        `${testFile} > parent`,
      ]);
    });
  });

  it('leaves a statically activated mutant alone', async () => {
    const { module, registrations, ns, env } = wrapped();
    ns.activeMutant = '3';
    module.it('runs', () => {});

    await bodyOf(registrations, 'runs')(testContext());

    assert.equal(ns.activeMutant, '3');
    assert.ok(!(activeMutantEnv in env));
  });

  it('clears the current test id after a test, also after a failure', async () => {
    const { module, registrations, ns, env } = wrapped();
    module.it('passes', () => {});
    module.it('fails', () => {
      throw new Error('no');
    });

    await bodyOf(registrations, 'passes')(testContext());

    assert.equal(ns.currentTestId, undefined);
    assert.ok(!(envNames.current in env));

    await assert.rejects(bodyOf(registrations, 'fails')(testContext()), { message: 'no' });

    assert.equal(ns.currentTestId, undefined);
    assert.ok(!(envNames.current in env));
  });

  it('registers the tests outside the filter as skipped, so node:test runs neither them nor their hooks', () => {
    const filter = [`${testFile} > group > wanted`, `${testFile} > elsewhere`];
    const { module, registrations } = wrapped(filter);
    module.describe('group', () => {
      module.it('wanted', { skip: false }, () => {});
      module.it('unwanted', { timeout: 5 }, () => {});
    });
    module.suite('unwanted group', { timeout: 6 }, () => {});
    module.test('other', () => {});
    module.test('calls back', (_t: unknown, done: () => void) => done());

    assert.deepEqual(
      registrations.map(({ name, rest }) => [name, rest[0]]),
      [
        ['group', { concurrency: false }],
        ['wanted', { skip: false, concurrency: false }],
        ['unwanted', { timeout: 5, concurrency: false, skip: true }],
        ['unwanted group', { timeout: 6, concurrency: false }],
        ['other', { concurrency: false, skip: true }],
        ['calls back', { concurrency: false, skip: true }],
      ],
    );
  });

  it('registers hooks without a function, as node:test allows', () => {
    const { module, registrations } = wrapped();
    module.before();
    module.after();
    module.describe('suite', () => {
      module.before();
      module.beforeEach();
      module.after();
      module.afterEach();
    });

    assert.deepEqual(
      registrations.filter(({ kind }) => kind !== 'describe').map(({ kind, rest }) => [kind, rest]),
      [
        ['before', [undefined]],
        ['after', [undefined]],
        ['before', [undefined]],
        ['beforeEach', [undefined]],
        ['after', [undefined]],
        ['afterEach', [undefined]],
      ],
    );
  });

  it('wraps the functions that `it` carries, as `it` is `test` in node:test', async () => {
    const { module, registrations, seen, see } = wrapped([`${testFile} > selected > wanted`]);
    const { it } = module;
    callMember(it, 'describe', 'unselected', () => {
      callMember(it, 'after', () => {});
    });
    callMember(it, 'describe', 'selected', () => {
      it('wanted', see);
    });

    await bodyOf(registrations, 'wanted')(testContext());

    assert.deepEqual(
      registrations.filter(({ kind }) => kind === 'after'),
      [],
    );
    assert.deepEqual(seen, [`${testFile} > selected > wanted`]);
    assert.equal(it, module.test);
  });

  it('runs the bodies of the suites outside the filter, but registers none of their hooks', () => {
    const { module, registrations, positions, sites } = wrapped([`${testFile} > selected > wanted`]);
    sites.push({ file: testFile, line: 2, column: 3 });
    const ran: string[] = [];
    const hook = () => {};
    const hooks = () => {
      const kinds: readonly ('before' | 'beforeEach' | 'after' | 'afterEach')[] = [
        'before',
        'beforeEach',
        'after',
        'afterEach',
      ];

      for (const kind of kinds) {
        module[kind](hook, { timeout: 5 });
      }
    };
    module.after(hook);
    sites.splice(0, Infinity, { file: testFile, line: 9, column: 1 });
    module.describe('selected', () => {
      ran.push('selected');
      hooks();
      module.it('wanted', () => {});
    });
    module.describe('unselected', () => {
      ran.push('unselected');
      hooks();
      module.describe('nested', () => {
        ran.push('nested');
        hooks();
      });
    });

    assert.deepEqual(ran, ['selected', 'unselected', 'nested']);
    assert.deepEqual(
      registrations
        .filter(({ kind }) => kind.startsWith('before') || kind.startsWith('after'))
        .map(({ kind, rest }) => [kind, rest[0] === hook, rest[1]]),
      [
        ['after', false, undefined],
        ['before', false, { timeout: 5 }],
        ['beforeEach', false, { timeout: 5 }],
        ['after', false, { timeout: 5 }],
        ['afterEach', true, { timeout: 5 }],
      ],
    );
    assert.deepEqual(positions.get(`${testFile} > "after" hook`), { line: 1, column: 2 });
  });

  it('runs every test of the file when the filter names the file itself', async () => {
    const { module, registrations, seen, see } = wrapped([testFile]);
    module.describe('group', () => {
      module.it('first', see);
    });
    module.test('second', see);

    await runBodies(registrations, ['first', 'second']);

    assert.deepEqual(seen, [`${testFile} > group > first`, `${testFile} > second`]);
  });

  const bails = [true, false].map((bail) => ({ bail, verb: bail ? 'skips' : 'runs', mode: bail ? 'on' : 'off' }));

  lzTestEach(bails)('$verb the tests after a reported failure with bail $mode', async ({ bail }) => {
    const { module, registrations, tests } = wrapped(undefined, bail);
    const ran: string[] = [];
    module.it('before the failure', () => {
      ran.push('before the failure');
    });
    module.it('later', () => {
      ran.push('later');
    });
    module.it('calls back later', (_t: unknown, done: () => void) => {
      ran.push('calls back later');
      done();
    });
    const calls: unknown[][] = [];

    tests.push({ id: `${testFile} > passed`, status: 'passed', timeSpentMs: 1 });
    tests.push({ id: `${testFile} > skipped`, status: 'skipped', timeSpentMs: 1 });
    await bodyOf(registrations, 'before the failure')(testContext());
    tests.push({ id: `${testFile} > failed`, status: 'failed', timeSpentMs: 1 });
    const later = testContext();
    await bodyOf(registrations, 'later')(later);
    const callsBackLater = testContext();
    await bodyOf(registrations, 'calls back later')(callsBackLater, (...args: unknown[]) => calls.push(args));

    assert.deepEqual(ran, bail ? ['before the failure'] : ['before the failure', 'later', 'calls back later']);
    assert.deepEqual([later.skipped, callsBackLater.skipped], [bail, bail]);
    assert.deepEqual(calls, bail ? [[]] : [[undefined]]);
  });
});
