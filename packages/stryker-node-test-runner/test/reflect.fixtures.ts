/** The member `key` of a value from a module whose types the tests cannot reach; nothing when it has none. */
export function member(value: unknown, key: string): unknown {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? Reflect.get(value, key)
    : undefined;
}

export function callMember(target: unknown, name: string, ...args: unknown[]): unknown {
  const fn = member(target, name);

  if (typeof fn !== 'function') {
    throw new TypeError(`There is no ${name} method to call.`);
  }

  const result: unknown = Reflect.apply(fn, target, args);

  return result;
}

export function construct(target: unknown, args: unknown[]): unknown {
  if (typeof target !== 'function') {
    throw new TypeError('There is no class to construct.');
  }

  const instance: unknown = Reflect.construct(target, args);

  return instance;
}
