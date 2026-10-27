import assert from 'node:assert/strict';
import { join } from 'node:path';

import type { NodeTestModule } from '../src/hook-core.ts';

export type Fn = (this: unknown, ...args: unknown[]) => unknown;

export interface Registration {
  kind: string;
  name: string;
  rest: unknown[];
  self: unknown;
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

export async function runBodies(registrations: Registration[], names: string[]): Promise<void> {
  for (const name of names) {
    await bodyOf(registrations, name)(testContext());
  }
}
