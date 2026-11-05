import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzTestFor } from '@layzee/node-test-extensions';
import type { HookDependencies, TestEvent } from '../../src/hook-core.ts';
import { envNames } from '../../src/record.ts';
import {
  afterHook,
  bodyOf,
  fileEnv,
  installedHarness,
  lifetime,
  ranAndReported,
  report,
  send,
  testFile,
  testContext,
  spans,
  type Harness,
} from '../hook-core.fixtures.ts';

/** Fires the one timer the hook set. */
function fireOnlyTimer(h: Harness): void {
  const [only, ...more] = h.timers;
  assert.ok(only, 'the hook set no timer');
  assert.equal(more.length, 0);
  only.fire();
}

/** node:test enqueues a top-level suite or test as it registers it, unless one of its filters leaves it out. */
function enqueue(deps: HookDependencies, ...names: readonly string[]): void {
  send(deps, ...names.map((name) => ({ type: 'test:enqueue', data: { name, nesting: 0 } })));
}

describe('install', () => {
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

      afterHook(h.fake, 0)();
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
      afterHook(h.fake, 0)();
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
      afterHook(h.fake, 0)();
      enqueue(h.deps, 'fails');
      report(h.deps, 'fails', 'fail');

      assert.deepEqual(h.exits, [1]);
    });

    it('ends no file whose tests all passed before the grace ends', async () => {
      const h = installedHarness(fileEnv());
      await ranAndReported(h, 'passes', 'pass');
      afterHook(h.fake, 0)();
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
      afterHook(h.fake, 0)();

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

        afterHook(h.fake, 0)();
        h.listResources(['PipeWrap', 'TCPServerWrap', 'PipeWrap']);
        fireOnlyTimer(h);
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
      fireOnlyTimer(h);
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

      fireOnlyTimer(h);

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
      afterHook(h.fake, 0)();
      h.listResources(['TCPServerWrap', 'Timeout']);
      fireOnlyTimer(h);
      h.exit({ natural: false });

      assert.deepEqual(h.records[0]?.record.heldOpen, ['TCPServerWrap', 'Timeout']);
    });

    it("starts the grace once the test file's root `after` hooks have settled, also one added while they run", async () => {
      const h = installedHarness(fileEnv());
      const { promise: firstSettles, resolve: resolveFirst }: PromiseWithResolvers<void> = Promise.withResolvers();
      h.wrapped().after(() => firstSettles);
      h.wrapped().after(() => {});
      const finished = afterHook(h.fake, 0);
      const first = afterHook(h.fake, 1);
      const second = afterHook(h.fake, 2);
      await ranAndReported(h, 'fails', 'fail');

      finished();
      const firstDone: unknown = first();
      h.wrapped().after(() => {});
      const added = afterHook(h.fake, 3);
      resolveFirst();
      await firstDone;
      await second();

      assert.deepEqual([h.timers.length, h.exits], [0, []]);

      await added();

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
      const finished = afterHook(h.fake, 0);
      const failing = afterHook(h.fake, 1);

      finished();
      await assert.rejects(
        async () => {
          await failing();
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
      const finished = afterHook(h.fake, 0);
      const callbackHook = afterHook(h.fake, 1);

      assert.equal(callbackHook.length, 2);

      finished();
      callbackHook({}, (given: unknown) => passed.push(given));

      assert.equal(h.timers.length, 0);

      callBack();

      assert.deepEqual([h.timers.length, passed], [error ? 1 : 0, [error]]);
    });

    it('starts the grace only once its own root `after` hook has run, as one added inside another hook runs earlier', async () => {
      const h = installedHarness(fileEnv());
      h.wrapped().after(() => {});
      const finished = afterHook(h.fake, 0);
      await afterHook(h.fake, 1)();

      assert.equal(h.timers.length, 0);

      finished();

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
        const finished = afterHook(h.fake, 0);

        finished();
        send(h.deps, event);

        assert.equal(h.timers.length, timers);
      },
    );

    it('does not start the grace at a root `after` hook that never settles when node:test reports the file failed before the tests finished, as node:test times out such a hook', () => {
      const h = installedHarness(fileEnv());
      h.wrapped().after(() => new Promise(() => {}));
      const finished = afterHook(h.fake, 0);

      send(h.deps, fileFailure);
      finished();

      assert.equal(h.timers.length, 0);
    });

    it('starts the grace once, whatever settles after it started', async () => {
      const h = installedHarness(fileEnv());
      h.wrapped().after(() => {
        throw new Error('after failed');
      });
      h.wrapped().after(() => {});
      const finished = afterHook(h.fake, 0);
      const failing = afterHook(h.fake, 1);
      const later = afterHook(h.fake, 2);

      finished();
      await assert.rejects(
        async () => {
          await failing();
        },
        { message: 'after failed' },
      );
      later();
      finished();

      assert.equal(h.timers.length, 1);
    });

    it('waits for no `after` hook of a suite, nor one registered without a function', () => {
      const h = installedHarness(fileEnv());
      h.wrapped().describe('suite', () => {
        h.wrapped().after(() => {});
      });
      h.wrapped().after();
      afterHook(h.fake, 0)();

      assert.equal(h.timers.length, 1);
    });
  });
});
