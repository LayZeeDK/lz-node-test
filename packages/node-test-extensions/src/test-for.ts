import type { TestContext } from 'node:test';

import { modified, type LzTestModified } from './modified.ts';
import { register, type Flags, type LzTestTableReturn, type Register } from './register.ts';

/** Registers the tests of a `lzTestFor` table. Without `fn`, each test is a todo test. */
export type LzTestForFunctionReturn<TArg> = LzTestTableReturn<
  (arg: TArg, context: TestContext) => void | Promise<void>
>;

export interface LzTestForFunction {
  <T>(cases: ReadonlyArray<T>): LzTestForFunctionReturn<T>;
  (
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): LzTestForFunctionReturn<Readonly<Record<string, unknown>>>;
}

type ForCallback = (row: never, t: TestContext) => void | Promise<void>;

/**
 * Registers one node:test `it` test per case of the table, as `lzTestEach` does, except that `fn` always gets the case
 * whole and node:test's test context as its second argument.
 */
export const lzTestFor: LzTestModified<LzTestForFunction> = modified(forCases, {});

function forCases(flags: Flags, cases: readonly unknown[]): Register<ForCallback> {
  return register<ForCallback>(flags, cases, (row) => ({
    items: row == null ? [] : Array.isArray(row) ? row : [row],
    run: async (fn, t) => {
      const result: unknown = Reflect.apply(fn, undefined, [row, t]);
      await result;
    },
  }));
}
