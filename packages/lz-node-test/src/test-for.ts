/* eslint-disable @typescript-eslint/no-explicit-any -- the types copy Vitest's test.for, whose any lets TypeScript infer each row's type */
import type { TestContext } from 'node:test';

import { modified, type LzModified } from './modified.ts';
import { register, type Flags, type LzTableReturn, type Register } from './register.ts';

/** Registers the tests of a `lzTestFor` table. Without `fn`, each test is a todo test. */
export type LzTestForFunctionReturn<TArg> = LzTableReturn<(arg: TArg, context: TestContext) => void | Promise<void>>;

export interface LzTestForFunction {
  <T>(cases: ReadonlyArray<T>): LzTestForFunctionReturn<T>;
  (strings: TemplateStringsArray, ...values: any[]): LzTestForFunctionReturn<any>;
}

type ForCallback = (row: any, t: TestContext) => void | Promise<void>;

/**
 * Registers one node:test `it` test per case of the table, as `lzTestEach` does, except that `fn` always gets the case
 * whole and node:test's test context as its second argument.
 */
export const lzTestFor: LzModified<LzTestForFunction> = modified(forCases, {});

function forCases(flags: Flags, cases: readonly unknown[]): Register<ForCallback> {
  return register<ForCallback>(flags, cases, (row) => ({
    items: row == null ? [] : Array.isArray(row) ? row : [row],
    run: (fn, t) => fn(row, t),
  }));
}
