import { AsyncLocalStorage } from 'node:async_hooks';
import type { HookFn, TestContext as NodeTestContext, TestFn } from 'node:test';

import type { InstrumenterContext, Position } from '@stryker-mutator/api/core';

import { activeMutantEnv, afterHookId, envNames, uniqueIds, within, type RecordedTest } from './record.ts';

/** A function call on the stack: its file path and its 1-based position. */
export interface CallSite {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/**
 * A function node:test calls, or a node:test function the wrapper calls with the arguments it was given, which
 * node:test checks itself. Every function is assignable to it; the wrappers call it through `Reflect.apply`.
 */
export type Body = (this: unknown, ...args: never[]) => unknown;
type Registrar = (this: unknown, name: string, ...rest: unknown[]) => unknown;
type HookRegistrar = (this: unknown, hook?: Body, ...rest: unknown[]) => unknown;
/**
 * A node:test function with its shorthands, which do not call the function itself. Tests have `expectFailure` from
 * Node.js 24.
 */
type WithShorthands<TFn> = TFn & {
  readonly skip: TFn;
  readonly todo: TFn;
  readonly only: TFn;
  readonly expectFailure?: TFn;
};
type Register = WithShorthands<Registrar>;

type NodeTestShape<TFn, THook> = WithShorthands<TFn> & {
  readonly describe: WithShorthands<TFn>;
  readonly suite: WithShorthands<TFn>;
  readonly it: WithShorthands<TFn>;
  readonly test: WithShorthands<TFn>;
  readonly before: THook;
  readonly beforeEach: THook;
  readonly after: THook;
  readonly afterEach: THook;
};

export type NodeTestModule = NodeTestShape<Registrar, HookRegistrar>;

export type NodeTestTarget = NodeTestShape<Body, Body>;

/**
 * Runs `hook` as node:test would, in its callback or promise style, and calls what `begin` returns when it settles: with
 * whether it failed. A `begin` that returns nothing leaves the call as it is.
 */
export function settling(hook: Body, begin: (context: unknown) => ((failed: boolean) => void) | undefined): Body {
  const call = (self: unknown, args: unknown[]): unknown => Reflect.apply(hook, self, args);
  const callSettling = (self: unknown, args: unknown[], settle: (failed: boolean) => void) => {
    try {
      return call(self, args);
    } catch (error) {
      settle(true);
      throw error;
    }
  };
  const callingBack: HookFn = function (this: unknown, context, done) {
    const settle = begin(context);

    if (settle === undefined) {
      return call(this, [context, done]);
    }

    return callSettling(
      this,
      [
        context,
        (error?: unknown) => {
          settle(Boolean(error));
          done(error);
        },
      ],
      settle,
    );
  };
  const promising = function (this: unknown, ...args: unknown[]) {
    const settle = begin(args[0]);

    if (settle === undefined) {
      return call(this, args);
    }

    return Promise.resolve(callSettling(this, args, settle)).then(
      (value) => {
        settle(false);

        return value;
      },
      (error: unknown) => {
        settle(true);
        throw error;
      },
    );
  };

  return hook.length === 2 ? callingBack : promising;
}

interface WrapOptions {
  readonly ns: InstrumenterContext;
  readonly testFile: string;
  readonly tests: readonly RecordedTest[];
  readonly filter: Set<string> | undefined;
  readonly bail: boolean;
  readonly activeMutant: string | undefined;
  readonly env: Record<string, string | undefined>;
  readonly positions: Map<string, Position>;
  readonly callSites: () => readonly CallSite[];
  readonly nodeTest: NodeTestTarget;
  /** Called before each suite, test or hook goes to node:test, `topLevel` for a suite or test outside any other. */
  readonly registering: (topLevel: boolean) => void;
  /** Wraps a function registered as an `after` hook outside any suite, a root `after` hook of the test file. */
  readonly rootAfter: (hook: Body) => Body;
}

/**
 * Supports synchronous suite bodies, and test bodies that return a value or a promise or that take node:test's `done`
 * callback. Bailing acts on the results node:test has reported, and node:test reports the first tests of a file only
 * once its reporters start, so a few quick tests can still run after the first failure.
 */
export function wrapNodeTest(options: WrapOptions): NodeTestModule {
  const {
    ns,
    testFile,
    tests,
    filter,
    bail,
    activeMutant,
    env,
    positions,
    callSites,
    nodeTest,
    registering,
    rootAfter,
  } = options;
  const idOf = uniqueIds();
  /**
   * node:test makes the suite or test whose body runs, followed through asynchronous calls, the parent of the suites
   * and tests registered with its module's functions.
   */
  const running = new AsyncLocalStorage<string>();
  const parentId = () => running.getStore() ?? testFile;
  const bailed = () => bail && tests.some((test) => test.status === 'failed');
  // The last is current, also when a subtest that its parent does not await outlives the parent's body.
  const active = new Set<string>();
  const setCurrent = () => {
    const id = [...active].at(-1);

    if (id === undefined) {
      delete ns.currentTestId;
      delete env[envNames.current];
    } else {
      ns.currentTestId = id;
      env[envNames.current] = id;
    }
  };
  const makeCurrent = (id: string) => {
    active.add(id);
    setCurrent();

    return () => {
      active.delete(id);
      setCurrent();
    };
  };
  /**
   * Whether the filter selects the test, or a subtest of it, which the test must run to register. Stryker names a
   * whole test file in the filter when --testFiles limits the run.
   */
  const selected = (id: string) => !filter || filter.has(testFile) || [...filter].some((test) => within(test, id));
  const activate = () => {
    if (activeMutant !== undefined) {
      ns.activeMutant = activeMutant;
      env[activeMutantEnv] = activeMutant;
    }
  };
  /** Like node:test's own filters, a suite without a selected test runs its body and registers none of its hooks. */
  const wrapHook = (
    register: Body,
    prepare: (hook: Body | undefined, suite: string | undefined) => Body | undefined = (hook) => hook,
  ): HookRegistrar =>
    function (this: unknown, hook?: Body, ...rest: unknown[]): unknown {
      const suite = running.getStore();

      if (suite !== undefined && !selected(suite)) {
        return undefined;
      }

      registering(false);

      return Reflect.apply(register, this, [prepare(hook, suite), ...rest]);
    };
  /**
   * node:test's `fullName` of each suite and test, by id, and the test each `fullName` names, or none for a suite or
   * a name that several share. node:test passes a hook the context of the test it runs for, or of its suite.
   */
  const fullNames = new Map<string, string>();
  const testsByFullName = new Map<string, string | undefined>();
  const testOf = (context: unknown) =>
    typeof context === 'object' && context !== null && 'fullName' in context && typeof context.fullName === 'string'
      ? testsByFullName.get(context.fullName)
      : undefined;
  /** Makes the test that `find` names current while the hook runs, unless that test is running already. */
  const attributing = (hook: Body | undefined, find: (context: unknown) => string | undefined): Body | undefined => {
    if (typeof hook !== 'function') {
      return hook;
    }

    /** Makes the test current and returns what ends that, or nothing when the hook runs as it is. */
    const attribute = (context: unknown) => {
      const id = find(context);

      if (id === undefined || active.has(id)) {
        return undefined;
      }

      return makeCurrent(id);
    };

    return settling(hook, attribute);
  };
  const activating = (hook: Body | undefined): Body | undefined => {
    // node:test registers a hook without a function, as one that does nothing.
    if (typeof hook !== 'function') {
      return hook;
    }

    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
      activate();

      return Reflect.apply(hook, this, args);
    };
    // node:test passes a `done` callback to a hook that declares a parameter for it.
    Object.defineProperty(wrapped, 'length', { value: hook.length });

    return wrapped;
  };

  /** node:test takes the position from its caller, which is a wrapper, so the wrapper finds it itself. */
  const declare = (id: string) => {
    const site = callSites().find(({ file }) => file === testFile);

    if (site) {
      positions.set(id, { line: site.line - 1, column: site.column - 1 });
    }
  };
  const named = (parent: string, name: string, test: boolean) => {
    registering(parent === testFile);
    const id = idOf(parent, name);
    const fullName = parent === testFile ? name : `${fullNames.get(parent)} > ${name}`;
    fullNames.set(id, fullName);
    testsByFullName.set(fullName, test && !testsByFullName.has(fullName) ? id : undefined);
    declare(id);

    return id;
  };

  /**
   * A suite's or test's arguments as node:test reads them: an optional name, options and body. node:test names one
   * without a non-empty name after its body, or `<anonymous>`; the wrapper passes the name on, as the body it passes
   * is its own.
   */
  const parse = (args: unknown[]) => {
    const body = args.find((arg): arg is Body => typeof arg === 'function');
    const options = args.find((arg): arg is object | null => typeof arg === 'object');
    const name = typeof args[0] === 'string' && args[0] !== '' ? args[0] : body?.name || '<anonymous>';

    return { name, options, body };
  };

  /**
   * Registers a suite or test with node:test. Every one is registered with `concurrency: false`, so the tests inside
   * it run one at a time, as node:test does without `concurrency`, and coverage goes to the one current test.
   */
  const registerWith = (
    register: Body,
    self: unknown,
    { name, options, body }: { name: string; options: object | null | undefined; body: Body | undefined },
  ): unknown => Reflect.apply(register, self, [name, { ...options, concurrency: false }, ...(body ? [body] : [])]);

  const wrapSuite = (register: Body): Registrar =>
    function (this: unknown, ...args: unknown[]) {
      const parsed = parse(args);
      const id = named(parentId(), parsed.name, false);
      const wrap = (suiteBody: Body) =>
        function (this: unknown, ...bodyArgs: unknown[]) {
          return running.run(id, (): unknown => Reflect.apply(suiteBody, this, bodyArgs));
        };

      return registerWith(register, this, { ...parsed, body: parsed.body && wrap(parsed.body) });
    };

  const wrapTest = (register: Body, parent = parentId): Registrar =>
    function (this: unknown, ...args: unknown[]) {
      const parsed = parse(args);
      const { options, body } = parsed;
      const id = named(parent(), parsed.name, true);
      /**
       * The test stays current until its body ends and node:test has run its afterEach hooks, whichever is later, as
       * node:test waits for the test's subtests and plan in between. Its `t.after` hooks run after that.
       */
      // The wrapper replaces these functions on node:test's own context, which the test body calls them on.
      const enter = (context: { test: Body; after: Body; beforeEach: Body }) => {
        const endCurrent = makeCurrent(id);
        let open = 2;
        const leave = () => {
          if (--open === 0) {
            endCurrent();
          }
        };
        const { after, beforeEach } = context;
        Reflect.apply(after, context, [leave]);
        // `t.test` registers a subtest of `t`'s test, wherever it is called.
        context.test = wrapTest(context.test, () => id);
        context.after = (hook?: Body, ...rest: unknown[]) =>
          Reflect.apply(after, context, [attributing(hook, () => id), ...rest]);
        context.beforeEach = (hook?: Body, ...rest: unknown[]) =>
          Reflect.apply(beforeEach, context, [attributing(hook, testOf), ...rest]);
        activate();

        return leave;
      };
      const wrap = (body: Body) => {
        // node:test passes a `done` callback only to a function whose length is exactly 2.
        if (body.length === 2) {
          const callingBack: TestFn = function (this: unknown, context, done) {
            if (bailed()) {
              context.skip();
              done();

              return;
            }

            const leave = enter(context);

            try {
              running.run(id, (): unknown =>
                Reflect.apply(body, this, [
                  context,
                  (error?: unknown) => {
                    leave();
                    done(error);
                  },
                ]),
              );
            } catch (error) {
              leave();
              throw error;
            }
          };

          return callingBack;
        }

        return async function (this: unknown, context: NodeTestContext, ...rest: unknown[]) {
          if (bailed()) {
            context.skip();

            return;
          }

          const leave = enter(context);

          try {
            return await running.run(id, (): unknown => Reflect.apply(body, this, [context, ...rest]));
          } finally {
            leave();
          }
        };
      };

      // A test registered as skipped runs neither its body nor its beforeEach and afterEach hooks.
      const skip = !selected(id) && { skip: true };

      return registerWith(register, this, { ...parsed, options: { ...options, ...skip }, body: body && wrap(body) });
    };

  // The bodies of skipped suites and tests never run, so `skip` only notes where they are declared.
  const declareSkipped = (register: Body): Registrar =>
    function (this: unknown, ...args: unknown[]): unknown {
      registering(parentId() === testFile);
      declare(idOf(parentId(), parse(args).name));

      return Reflect.apply(register, this, args);
    };
  const withShorthands = (original: WithShorthands<Body>, wrap: (register: Body) => Registrar): Register =>
    Object.assign(wrap(original), original, {
      skip: declareSkipped(original.skip),
      todo: wrap(original.todo),
      only: wrap(original.only),
      ...(original.expectFailure && { expectFailure: wrap(original.expectFailure) }),
    });
  // The module is node:test's `test` function, which also carries the other functions; `it` is the same function.
  const test = withShorthands(nodeTest, wrapTest);

  return Object.assign(test, {
    describe: withShorthands(nodeTest.describe, wrapSuite),
    suite: withShorthands(nodeTest.suite, wrapSuite),
    it: test,
    test,
    // A `before` hook outside any suite runs as soon as it is registered, while the file loads, like the rest of the
    // file's top level; it runs before the mutant is active.
    before: wrapHook(nodeTest.before, (hook, suite) => (suite === undefined ? hook : activating(hook))),
    beforeEach: wrapHook(nodeTest.beforeEach, (hook) => attributing(activating(hook), testOf)),
    after: wrapHook(nodeTest.after, (hook, suite) => {
      // node:test reports a failing `after` hook outside any suite as a failure of the test file, at the position it
      // takes from its caller, which is this wrapper.
      const attributed = attributing(hook, testOf);

      if (suite !== undefined) {
        return attributed;
      }

      declare(afterHookId(testFile));

      return typeof attributed === 'function' ? rootAfter(attributed) : attributed;
    }),
    afterEach: wrapHook(nodeTest.afterEach),
  });
}
