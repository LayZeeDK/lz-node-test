import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzTestEach } from '@layzee/lz-node-test';
import { envNames } from '../../src/record.ts';
import { bodyOf, callable, hooksOf, rawBodyOf, testFile, testContext, type Fn } from '../hook-core.fixtures.ts';
import { wrapped, type Subtests } from '../wrap.fixtures.ts';

describe('wrapNodeTest', () => {
  describe('hooks', () => {
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
      const thrown = throwing(testContext([], 'first'));

      assert.equal(ns.currentTestId, undefined);
      assert.ok(thrown instanceof Promise);
      await assert.rejects(thrown, failure);
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
      const { promise: gate, resolve: release } = Promise.withResolvers<void>();
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

    lzTestEach([
      ['makes t.runOnly do nothing in every hook without --test-only', false, []],
      ['leaves t.runOnly in every hook to node:test under --test-only', true, [[true], [true], [true], [true], [true]]],
    ])('%s', async (_title, testOnly, expected) => {
      const { module, registrations } = wrapped({ testOnly });
      const calls: unknown[][] = [];
      const runOnly = (t: { readonly runOnly: (only: boolean) => void }) => {
        t.runOnly(true);
      };
      module.before(runOnly);
      module.beforeEach(runOnly);
      module.afterEach(runOnly);
      module.after(runOnly);
      module.it('parent', (t: { readonly beforeEach: (hook: typeof runOnly) => void }) => {
        t.beforeEach(runOnly);
      });

      await bodyOf(registrations, 'parent')(testContext(registrations, 'parent'));
      const hooks = ['before', 'beforeEach', 'afterEach', 'after', 't.beforeEach'].flatMap((kind) =>
        hooksOf(registrations, kind),
      );
      const contextWithRunOnly = () =>
        Object.assign(testContext(), {
          runOnly: (...args: unknown[]) => {
            calls.push(args);
          },
        });
      await Promise.all(hooks.map((hook) => hook(contextWithRunOnly())));

      assert.equal(hooks.length, 5);
      assert.deepEqual(calls, expected);
    });
  });
});
