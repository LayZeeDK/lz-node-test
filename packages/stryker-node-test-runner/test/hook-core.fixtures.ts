import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { LoadHookContext, ResolveHookContext } from 'node:module';
import { join } from 'node:path';
import { compileFunction } from 'node:vm';

import { install, wrappedNodeTest, type HookDependencies, type ModuleHooks, type TestEvent } from '../src/hook-core.ts';
import { envNames, lzParseRecord, lzRecordNonce, type ProcessRecord } from '../src/record.ts';
import type { NodeTestModule } from '../src/wrap.ts';

export type Fn = (this: unknown, ...args: unknown[]) => unknown;

export interface Registration {
  readonly kind: string;
  readonly name: string;
  readonly rest: readonly unknown[];
  readonly self: unknown;
}

export const testFile = join('/repo', 'a.test.ts');

/** Lets a test call a function it only holds as `unknown`, such as one the code under test registered. */
export function callable(value: unknown): Fn {
  if (typeof value !== 'function') {
    throw new TypeError(`${String(value)} is no function.`);
  }

  const call = function (this: unknown, ...args: unknown[]) {
    const result: unknown = Reflect.apply(value, this, args);

    return result;
  };

  // The wrapper declares the same parameters, as node:test passes `done` by a function's length.
  return Object.defineProperty(call, 'length', { value: value.length });
}

export function fakeNodeTest(expectFailure = true) {
  const registrations: Registration[] = [];
  const suiteResults: unknown[] = [];
  const register = (kind: string) =>
    function (this: unknown, name: string, ...rest: unknown[]) {
      registrations.push({ kind, name, rest, self: this });
      const body = rest.find((arg) => typeof arg === 'function');

      if (/^(describe|suite)(\.only|\.todo)?$/.test(kind) && typeof body === 'function') {
        try {
          suiteResults.push(Reflect.apply(body, 'suite this', ['suite argument']));
        } catch (error) {
          suiteResults.push(error);
        }
      }

      return `${kind} ${name}`;
    };
  const hook = (kind: string) =>
    function (this: unknown, ...rest: unknown[]) {
      registrations.push({ kind, name: kind, rest, self: this });

      return kind;
    };
  const withShorthands = (kind: string, tests = true) =>
    Object.assign(register(kind), {
      skip: register(`${kind}.skip`),
      todo: register(`${kind}.todo`),
      only: register(`${kind}.only`),
      ...(tests && expectFailure && { expectFailure: register(`${kind}.expectFailure`) }),
      mock: `${kind}.mock`,
    });
  const test = withShorthands('test');
  const module: NodeTestModule = Object.assign(test, {
    describe: withShorthands('describe', false),
    suite: withShorthands('suite', false),
    it: test,
    test,
    before: hook('before'),
    beforeEach: hook('beforeEach'),
    after: hook('after'),
    afterEach: hook('afterEach'),
    run: 'run',
  });

  return { module, registrations, suiteResults };
}

/** Runs its `after` hooks on `end()`, as node:test does once a test's body ends, after its afterEach hooks. */
export function testContext(registrations: Registration[] = [], fullName?: string) {
  const afterHooks: Fn[] = [];
  const context = {
    fullName,
    skipped: false,
    skip: () => {
      context.skipped = true;
    },
    test: function (this: unknown, name: string, ...rest: unknown[]) {
      registrations.push({ kind: 't.test', name, rest, self: this });

      return `t.test ${name}`;
    },
    after: function (this: unknown, hook: Fn) {
      assert.equal(this, context);
      afterHooks.push(hook);
    },
    beforeEach: function (this: unknown, ...rest: unknown[]) {
      registrations.push({ kind: 't.beforeEach', name: 't.beforeEach', rest, self: this });
    },
    end: async () => {
      for (const hook of afterHooks.splice(0)) {
        await hook(context);
      }
    },
  };

  return context;
}

export function rawBodyOf(registrations: Registration[], name: string): Fn {
  const registration = registrations.find((candidate) => candidate.name === name);
  assert.ok(registration, `${name} was not registered`);

  return callable(registration.rest.find((arg) => typeof arg === 'function'));
}

export function hooksOf(registrations: { kind: string; rest: readonly unknown[] }[], kind: string): Fn[] {
  return registrations.filter((registration) => registration.kind === kind).map(({ rest }) => callable(rest[0]));
}

export function bodyOf(
  registrations: Registration[],
  name: string,
): (this: unknown, ...args: unknown[]) => Promise<unknown> {
  const body = rawBodyOf(registrations, name);

  return async function (this: unknown, ...args: unknown[]) {
    try {
      return await body.apply(this, args);
    } finally {
      const [context] = args;

      if (typeof context === 'object' && context !== null && 'end' in context && typeof context.end === 'function') {
        await Reflect.apply(context.end, context, []);
      }
    }
  };
}

export type TestDetails = NonNullable<TestEvent['data']['details']>;

export const out = join('/tmp', 'out');

export function reported(
  name: string,
  nesting: number,
  outcome: 'pass' | 'fail',
  details: TestDetails,
  flags: { skip?: unknown; todo?: unknown } = {},
): TestEvent[] {
  return [
    { type: 'test:start', data: { name, nesting } },
    { type: `test:${outcome}`, data: { name, nesting, ...flags, details } },
  ];
}

export function resolveContext(conditions: string[]): ResolveHookContext {
  return { conditions, importAttributes: {}, parentURL: undefined };
}

export function loadContext(conditions: string[]): LoadHookContext {
  return { conditions, format: undefined, importAttributes: {} };
}

export interface Harness {
  readonly deps: HookDependencies;
  readonly fake: ReturnType<typeof fakeNodeTest>;
  readonly records: readonly { readonly path: string; readonly record: ProcessRecord }[];
  readonly calls: readonly string[];
  readonly hooks: readonly ModuleHooks[];
  readonly wrapped: () => NodeTestModule;
  /** Adds an exit listener as the test file would, after the hook's. */
  readonly onExit: (listener: () => void) => void;
  /** Runs the `beforeExit` listeners, as Node.js does once the event loop is empty. */
  readonly emptied: () => void;
  /** Runs the listeners as Node.js does: `beforeExit` on a natural end, then the exit listeners there are then. */
  readonly exit: (options?: { readonly natural: boolean }) => void;
  /** The codes the hook ended the process with, `undefined` for node:test's own. */
  readonly exits: readonly (number | undefined)[];
  /** The timers the hook set, by delay, which a test fires by calling them. */
  readonly timers: readonly { readonly ms: number; readonly fire: () => void }[];
  /** Sets what `process.getActiveResourcesInfo()` lists from then on, as the tests open or close things; at first `PipeWrap`. */
  readonly listResources: (resources: readonly string[]) => void;
}

export function harness(env: Record<string, string | undefined>, overrides: Partial<HookDependencies> = {}): Harness {
  const fake = fakeNodeTest();
  const records: Harness['records'][number][] = [];
  const calls: string[] = [];
  const hooks: ModuleHooks[] = [];
  const listeners: (() => void)[] = [];
  const beforeExitListeners: (() => void)[] = [];
  const exits: Harness['exits'][number][] = [];
  const timers: Harness['timers'][number][] = [];
  let resources: readonly string[] = ['PipeWrap'];
  const emptied = () => {
    for (const listener of [...beforeExitListeners]) {
      listener();
    }
  };
  const deps: HookDependencies = {
    env,
    execArgv: [],
    mainFile: testFile,
    pid: 4321,
    nonce: lzRecordNonce(),
    threadId: 0,
    global: { globalThis: undefined },
    nodeTest: () => {
      calls.push('nodeTest');

      return fake.module;
    },
    registerHooks: (registered) => {
      calls.push(deps.global[wrappedNodeTest] ? 'registerHooks' : 'registerHooks before publishing');
      hooks.push(registered);
    },
    onExit: (listener) => {
      calls.push('onExit');
      listeners.push(listener);
    },
    offExit: (listener) => {
      calls.push('offExit');
      listeners.splice(listeners.lastIndexOf(listener), 1);
    },
    onBeforeExit: (listener) => {
      beforeExitListeners.push(listener);
    },
    writeRecord: (path, record) => {
      records.push({ path, record: lzParseRecord(JSON.stringify(record)) });
    },
    every: () => {},
    exit: (code) => {
      exits.push(code);
    },
    activeResources: () => resources,
    later: (fire, ms) => {
      timers.push({ ms, fire });
    },
    canWriteRecords: true,
    peakMemoryMB: () => 123,
    canWatchMemory: true,
    watchMemory: (options) => {
      calls.push(`watchMemory ${JSON.stringify(options)}`);

      return 'the watchdog';
    },
    callSites: () => [],
    now: () => 0,
    signals: undefined,
    platform: 'win32',
    parentPid: () => 1000,
    kill: () => {
      assert.fail('the hook ended a process group');
    },
    ...overrides,
  };

  return {
    deps,
    fake,
    records,
    calls,
    hooks,
    exits,
    timers,
    listResources: (now) => {
      resources = now;
    },
    wrapped: () => {
      const wrapped = deps.global[wrappedNodeTest];
      assert.ok(wrapped, 'the hook published no wrapped node:test');

      return wrapped;
    },
    onExit: (listener) => {
      listeners.push(listener);
    },
    emptied,
    exit: ({ natural } = { natural: true }) => {
      if (natural) {
        emptied();
      }

      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

/** The harness's clock stays at 0. */
export const lifetime = { start: 0, end: 0 };
export const spans = (...ran: string[]) => Object.fromEntries(ran.map((name) => [`${testFile} > ${name}`, [lifetime]]));

/** The environment of the process that runs the test file, new each time as the hook changes it. */
export const fileEnv = () => ({ [envNames.out]: out, [envNames.file]: testFile });

export function installedHarness(
  env: Record<string, string | undefined>,
  overrides: Partial<HookDependencies> = {},
): Harness {
  const h = harness(env, overrides);
  install(h.deps);

  return h;
}

/** Imports and requires node:test through `hooks`, with `wrapped`, which may be any fake, as the wrapped module. */
export async function importRedirected(hooks: ModuleHooks, wrapped: unknown) {
  const slots: Record<symbol, unknown> = globalThis;
  const previous = slots[wrappedNodeTest];
  const passOn = () => assert.fail('passed node:test on');
  const sourceFor = (conditions: string[]) => {
    const { url } = hooks.resolve('node:test', resolveContext(conditions), passOn);
    const { source } = hooks.load(url, loadContext(conditions), passOn);

    if (typeof source !== 'string') {
      throw new TypeError(`Loaded no source text: ${typeof source}`);
    }

    return source;
  };

  try {
    slots[wrappedNodeTest] = wrapped;
    // A comment of its own keeps the import from coming from the module cache.
    const source = `${sourceFor(['node', 'import'])}\n// ${randomUUID()}`;
    const module: unknown = await import(`data:text/javascript,${encodeURIComponent(source)}`);

    if (typeof module !== 'object' || module === null) {
      throw new TypeError('The redirected import gave no module.');
    }

    const commonjs: { exports: unknown } = { exports: undefined };
    Reflect.apply(compileFunction(sourceFor(['node', 'require']), ['module']), undefined, [commonjs]);

    return { module, commonjs: commonjs.exports };
  } finally {
    slots[wrappedNodeTest] = previous;
  }
}
