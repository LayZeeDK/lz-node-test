export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const isNumber = (value: unknown) => typeof value === 'number';
export const isString = (value: unknown) => typeof value === 'string';
export const isStrings = (value: unknown) => Array.isArray(value) && value.every(isString);

/** `value` under `key` when it is there and passes `check`; nothing when it is not there. `fail` names `field`. */
export function optional<TKey extends string, T>(
  key: TKey,
  value: unknown,
  check: (value: unknown) => value is T,
  fail: (field: string) => never,
  field: string = key,
): { [P in TKey]?: T } {
  const result: { [P in TKey]?: T } = {};

  if (value === undefined) {
    return result;
  }

  if (!check(value)) {
    fail(field);
  }

  result[key] = value;

  return result;
}
