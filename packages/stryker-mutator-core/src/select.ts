import { isObject } from './guards.ts';
import type { LzOperator } from './operator.ts';

/** The mutators a package installs: those that run unless a config leaves them out, and those a user turns on. */
export interface LzOperatorSets {
  readonly defaults: readonly LzOperator[];
  readonly optIn: readonly LzOperator[];
  readonly experimental: readonly LzOperator[];
}

/**
 * The mutators a user turns on besides the defaults: every opt-in mutator with `extended`, or one by its name, and every
 * experimental mutator with `experimental`, or one by its name inside it. Only `true` turns one on; Stryker's
 * `mutator.excludedMutations` turns mutators off.
 */
export type LzMutatorOptions<TOptIn extends string, TExperimental extends string> = {
  readonly [TName in TOptIn]?: true;
} & {
  readonly extended?: true;
  readonly experimental?: true | { readonly [TName in TExperimental]?: true };
};

/**
 * The defaults and the operators that `options` turns on, in the order of `sets`. Throws, starting with
 * `packageName`, on options it does not take, as a config file in JavaScript has no type check.
 */
export function lzSelectOperators(packageName: string, sets: LzOperatorSets, options: unknown): readonly LzOperator[] {
  const selected = new Set<LzOperator>(sets.defaults);

  for (const [key, value] of entriesOf(packageName, 'the options', options ?? {})) {
    if (key === 'experimental') {
      selectExperimental(packageName, sets, value).forEach((operator) => selected.add(operator));
      continue;
    }

    onlyTrue(packageName, key, value);
    (key === 'extended' ? sets.optIn : [named(packageName, sets, 'optIn', key)]).forEach((operator) => {
      selected.add(operator);
    });
  }

  return [...sets.defaults, ...sets.optIn, ...sets.experimental].filter((operator) => selected.has(operator));
}

function selectExperimental(packageName: string, sets: LzOperatorSets, value: unknown): readonly LzOperator[] {
  if (value === true) {
    return sets.experimental;
  }

  return entriesOf(packageName, 'experimental', value).map(([key, member]) => {
    onlyTrue(packageName, `experimental.${key}`, member);

    return named(packageName, sets, 'experimental', key);
  });
}

function entriesOf(packageName: string, what: string, value: unknown): [string, unknown][] {
  if (!isObject(value) || Array.isArray(value)) {
    throw new Error(`${packageName}: ${what} must be an object, not ${JSON.stringify(value)}.`);
  }

  return Object.keys(value).map((key) => {
    const member: unknown = Reflect.get(value, key);

    return [key, member];
  });
}

function onlyTrue(packageName: string, key: string, value: unknown): void {
  if (value !== true) {
    throw new Error(
      `${packageName}: ${key} takes only true, not ${JSON.stringify(value)}; Stryker's mutator.excludedMutations ` +
        'turns mutators off.',
    );
  }
}

/** The operator of `set` named `name`; throws with where the name belongs, or which names there are, when none is. */
function named(packageName: string, sets: LzOperatorSets, set: 'optIn' | 'experimental', name: string): LzOperator {
  const found = sets[set].find((operator) => operator.name === name);

  if (found !== undefined) {
    return found;
  }

  throw new Error(
    `${packageName}: no ${set === 'optIn' ? 'opt-in' : 'experimental'} mutator is named ${name}; ` +
      `${whereNamed(sets, set, name)}.`,
  );
}

function whereNamed(sets: LzOperatorSets, set: 'optIn' | 'experimental', name: string): string {
  const has = (operators: readonly LzOperator[]) => operators.some((operator) => operator.name === name);

  if (has(sets.defaults)) {
    return 'it runs by default';
  }

  if (set === 'optIn' && has(sets.experimental)) {
    return 'it is experimental, so it goes inside experimental';
  }

  if (set === 'experimental' && has(sets.optIn)) {
    return 'it is opt-in, so it goes outside experimental';
  }

  return `the names are ${sets[set].map((operator) => operator.name).join(', ') || 'none'}`;
}
