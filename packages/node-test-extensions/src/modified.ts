import type { Flags, Register } from './register.ts';

/**
 * A table function with its modifiers, chained before the table. `skip`, `only`, `todo` and `fails` each turn their
 * flag on, so they compose in any order. `skipIf` and `runIf` turn `skip` on when their condition asks for it and
 * otherwise leave it as it is, as in Vitest, so a `skip` before or after them always holds.
 */
export type LzTestModified<TFunction> = TFunction & {
  readonly skip: LzTestModified<TFunction>;
  readonly only: LzTestModified<TFunction>;
  readonly todo: LzTestModified<TFunction>;
  readonly fails: LzTestModified<TFunction>;
  skipIf(condition: unknown): LzTestModified<TFunction>;
  runIf(condition: unknown): LzTestModified<TFunction>;
};

type Table<TCallback> = (cases: readonly unknown[], ...values: unknown[]) => Register<TCallback>;

/** The table function for `cases`, which turns a table into its tests' `Register`, with `flags` and the modifiers. */
export function modified<TCallback>(
  cases: (flags: Flags, rows: readonly unknown[]) => Register<TCallback>,
  flags: Flags,
): LzTestModified<Table<TCallback>> {
  const table: Table<TCallback> = (rows, ...values) =>
    cases(flags, values.length > 0 ? templateRows(rows, values) : rows);
  const flag = (key: keyof Flags) => () => modified(cases, { ...flags, [key]: true });
  const skipWhen = (skip: boolean) => modified(cases, skip ? { ...flags, skip } : flags);
  const withConditions = Object.assign(table, {
    skipIf: (condition: unknown) => skipWhen(Boolean(condition)),
    runIf: (condition: unknown) => skipWhen(!condition),
  });

  // The modifiers are getters, as assigning them would build every chain of modifiers at once, without end.
  defineGetter(withConditions, 'skip', flag('skip'));
  defineGetter(withConditions, 'only', flag('only'));
  defineGetter(withConditions, 'todo', flag('todo'));
  defineGetter(withConditions, 'fails', flag('fails'));

  return withConditions;
}

/** The rows of a template literal table: one object per row, keyed by the column names of its first line. */
export function templateRows(strings: readonly unknown[], values: readonly unknown[]): Record<string, unknown>[] {
  const columns = strings
    .join('')
    .trim()
    .replaceAll(' ', '')
    .split('\n', 1)
    .flatMap((line) => line.split('|'));

  // Array.from rounds the length down, which drops the values of an incomplete last row.
  return Array.from({ length: values.length / columns.length }, (_, row) =>
    Object.fromEntries(columns.map((column, i) => [column, values[row * columns.length + i]])),
  );
}

/** Defines a getter on `target` and types it there, as TypeScript does not type what Object.defineProperty adds. */
function defineGetter<T extends object, TKey extends PropertyKey, TValue>(
  target: T,
  key: TKey,
  get: () => TValue,
): asserts target is T & { readonly [P in TKey]: TValue } {
  Object.defineProperty(target, key, { get });
}
