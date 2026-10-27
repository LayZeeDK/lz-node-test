/* eslint-disable @typescript-eslint/no-explicit-any -- the types copy Vitest's test.for, whose any lets TypeScript infer each row's type */
import type { TestContext } from 'node:test';

import { modified, type Modified } from './modified.ts';
import { register, type Awaitable, type EachOptions, type Flags, type Name, type Register } from './register.ts';

/** Registers the tests of a `lzTestFor` table. Without `fn`, each test is a todo test. */
export interface LzTestForFunctionReturn<TArg> {
  (name: Name, fn?: (arg: TArg, context: TestContext) => Awaitable<void>, timeout?: number): void;
  (name: Name, options: EachOptions, fn?: (arg: TArg, context: TestContext) => Awaitable<void>): void;
}

export interface LzTestForFunction {
  <T>(cases: ReadonlyArray<T>): LzTestForFunctionReturn<T>;
  (strings: TemplateStringsArray, ...values: any[]): LzTestForFunctionReturn<any>;
}

type ForCallback = (row: any, t: TestContext) => Awaitable<void>;

/**
 * Registers one node:test `it` test per case of the table, as `lzTestEach` does, except that `fn` always gets the case
 * whole and node:test's test context as its second argument.
 */
export const lzTestFor: Modified<LzTestForFunction> = modified(forCases, {});

function forCases(flags: Flags, cases: readonly unknown[]): Register<ForCallback> {
  return register<ForCallback>(flags, cases, (row, fn) => ({
    items: row == null ? [] : Array.isArray(row) ? row : [row],
    ...(fn && { body: (t: TestContext) => fn(row, t) }),
  }));
}
