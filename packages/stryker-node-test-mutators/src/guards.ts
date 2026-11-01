import { lzPackageName } from './package-name.ts';

/** Every function is assignable to it, and `Reflect.apply` and `Reflect.construct` call it. */
export type AnyFunction = (...args: never) => unknown;

export function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

export function isFunction(value: unknown): value is AnyFunction {
  return typeof value === 'function';
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

export function hasMember<TKey extends string, T>(
  value: unknown,
  key: TKey,
  check: (member: unknown) => member is T,
): value is Record<TKey, T> {
  return isObject(value) && check(Reflect.get(value, key));
}

/** The member of `value` under `key` that passes `check`; throws, naming `source`, when there is none. */
export function member<T>(value: unknown, key: string, check: (member: unknown) => member is T, source: string): T {
  const found: unknown = isObject(value) ? Reflect.get(value, key) : undefined;

  if (!check(found)) {
    throw new Error(`${lzPackageName}: ${source} has no ${key} of the shape this module reads.`);
  }

  return found;
}
