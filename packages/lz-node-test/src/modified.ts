import { templateRows, type Flags, type Register } from './register.ts';

/**
 * A table function with its modifiers, chained before the table. `skip`, `only`, `todo` and `fails` each turn their
 * flag on, so they compose in any order. `skipIf` and `runIf` set `skip` to true or false, as in Vitest, so they
 * override a `skip` before them and are overridden by one after them.
 */
export type Modified<F> = F & {
  readonly skip: Modified<F>;
  readonly only: Modified<F>;
  readonly todo: Modified<F>;
  readonly fails: Modified<F>;
  skipIf(condition: unknown): Modified<F>;
  runIf(condition: unknown): Modified<F>;
};

type Table<F> = (cases: readonly unknown[], ...values: unknown[]) => Register<F>;

/** The table function for `cases`, which turns a table into its tests' `Register`, with `flags` and the modifiers. */
export function modified<F>(
  cases: (flags: Flags, rows: readonly unknown[]) => Register<F>,
  flags: Flags,
): Modified<Table<F>> {
  const table: Table<F> = (rows, ...values) => cases(flags, values.length > 0 ? templateRows(rows, values) : rows);
  const flag = (key: keyof Flags) => () => modified(cases, { ...flags, [key]: true });
  const withConditions = Object.assign(table, {
    skipIf: (condition: unknown) => modified(cases, { ...flags, skip: Boolean(condition) }),
    runIf: (condition: unknown) => modified(cases, { ...flags, skip: !condition }),
  });

  // The modifiers are getters, as assigning them would build every chain of modifiers at once, without end.
  defineGetter(withConditions, 'skip', flag('skip'));
  defineGetter(withConditions, 'only', flag('only'));
  defineGetter(withConditions, 'todo', flag('todo'));
  defineGetter(withConditions, 'fails', flag('fails'));

  return withConditions;
}

/** Defines a getter on `target` and types it there, as TypeScript does not type what Object.defineProperty adds. */
function defineGetter<T extends object, K extends PropertyKey, V>(
  target: T,
  key: K,
  get: () => V,
): asserts target is T & { readonly [P in K]: V } {
  Object.defineProperty(target, key, { get });
}
