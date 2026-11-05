// Registers the tests of Vitest's test.each and test.for tables on node:test. node:test underneath makes two outcomes
// differ from Vitest's: a todo test that has a body runs it, as node:test runs todo tests and ignores their outcome,
// and a `fails` test that times out does not pass, as node:test's timeout applies outside the body that `fails`
// inverts. title.ts names the tests.
import { it, type TestContext, type TestOptions } from 'node:test';

import { formatName, formatTitle } from './title.ts';

/** A test's name: a string, or a function or class, which names it by its own name and is never called. */
export type LzTestName = string | ((...args: never) => unknown) | (abstract new (...args: never) => unknown);

/** node:test's options for each test of the table, and `fails`, which makes a test pass only when its body fails. */
export interface LzTestTableOptions extends TestOptions {
  readonly fails?: boolean;
}

export type Flags = Pick<LzTestTableOptions, 'skip' | 'only' | 'todo' | 'fails'>;
export type EachCallback = (...args: never) => void | Promise<void>;
type Body = (t: TestContext) => void | Promise<void>;

/** The typed function a table returns, with the callback type its table function gives `fn`. */
export interface LzTestTableReturn<TCallback> {
  (name: LzTestName, fn?: TCallback, timeout?: number): void;
  (name: LzTestName, options: LzTestTableOptions, fn?: TCallback): void;
}

/** What the table's returned function takes, in any of Vitest's call shapes. */
export type Register<TCallback> = (
  name: LzTestName,
  optionsOrFn?: TCallback | LzTestTableOptions,
  fnOrTimeout?: TCallback | number,
) => void;

/** One test of the table: the values its name formats, and how it calls the table's function. */
interface Case<TCallback> {
  readonly items: readonly unknown[];
  readonly run: (fn: TCallback, t: TestContext) => void | Promise<void>;
}

const signatures =
  'lzTestEach and lzTestFor tables take (name, fn), (name, fn, timeout) or (name, options, fn); ' +
  'pass options as the second argument and a single function.';

/**
 * Reads Vitest's call shapes: `(name, fn)`, `(name, fn, timeout)` and `(name, options, fn)`. Untyped callers can pass
 * other shapes, which throw; the parameter types include the nulls and the misplaced options they can pass.
 */
export function parseArguments<TCallback extends EachCallback>(
  optionsOrFn: TCallback | LzTestTableOptions | null | undefined,
  fnOrTimeout: TCallback | LzTestTableOptions | number | null | undefined,
): { options: LzTestTableOptions; fn?: TCallback } {
  if (
    optionsOrFn === null ||
    (typeof fnOrTimeout === 'object' && fnOrTimeout !== null) ||
    (typeof optionsOrFn === 'function' && typeof fnOrTimeout === 'function')
  ) {
    throw new TypeError(signatures);
  }

  const options =
    typeof fnOrTimeout === 'number' ? { timeout: fnOrTimeout } : typeof optionsOrFn === 'object' ? optionsOrFn : {};
  const fn =
    typeof optionsOrFn === 'function' ? optionsOrFn : typeof fnOrTimeout === 'function' ? fnOrTimeout : undefined;

  return fn === undefined ? { options } : { options, fn };
}

/** Registers one test per case, each named after `name` and its case, with the table's options. */
export function register<TCallback extends EachCallback>(
  flags: Flags,
  cases: readonly unknown[],
  caseOf: (row: unknown) => Case<TCallback>,
): Register<TCallback> {
  return (name, optionsOrFn, fnOrTimeout) => {
    const template = formatName(name);
    const { options, fn } = parseArguments(optionsOrFn, fnOrTimeout);
    const defined = Object.entries(options).filter(([, value]) => value !== undefined);
    const { fails, ...testOptions }: LzTestTableOptions = { ...flags, ...Object.fromEntries(defined) };

    if (!fn) {
      testOptions.todo ||= true;
    }

    cases.forEach((row, index) => {
      const { items, run } = caseOf(row);
      const body = fn && ((t: TestContext) => run(fn, t));

      it(formatTitle(template, items, index), testOptions, fails ? body && failing(body) : body);
    });
  };
}

/** Inverts the outcome of a test's body: the test passes when the body throws or rejects, and fails otherwise. */
function failing(call: Body): Body {
  return async (t) => {
    try {
      await call(t);
    } catch {
      return;
    }

    throw new Error('The test passed, but it is marked to fail.');
  };
}
