import { inspect } from 'node:util';

import { isObject } from './guards.ts';
import type { LzMutator } from './mutator.ts';

/** The mutators a package installs: those that run unless a config leaves them out, and those a user turns on. */
export interface LzMutatorSets {
  readonly defaults: readonly LzMutator[];
  readonly optIn: readonly LzMutator[];
  readonly experimental: readonly LzMutator[];
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

type LzTier = keyof LzMutatorSets;

const tiers: readonly LzTier[] = ['defaults', 'optIn', 'experimental'];
type LzSelectableTier = Exclude<LzTier, 'defaults'>;

const tierNames: Record<LzSelectableTier, string> = { optIn: 'opt-in', experimental: 'experimental' };
const whereTiersGo: Record<LzTier, string> = {
  defaults: 'it runs by default',
  optIn: 'it is opt-in, so it goes outside experimental',
  experimental: 'it is experimental, so it goes inside experimental',
};

/** Every mutator of `sets`, defaults first. */
export function lzAllMutators(sets: LzMutatorSets): readonly LzMutator[] {
  return tiers.flatMap((tier) => sets[tier]);
}

/**
 * The defaults and the mutators that `options` turns on, in the order of `sets`. Throws, starting with
 * `packageName`, on options it does not take, as a config file in JavaScript has no type check.
 */
export function lzSelectMutators(packageName: string, sets: LzMutatorSets, options: unknown): readonly LzMutator[] {
  const tierOf = new Map(tiers.flatMap((tier) => sets[tier].map(({ name }): [string, LzTier] => [name, tier])));
  const named = (tier: LzSelectableTier, name: string): readonly LzMutator[] => {
    const found = tierOf.get(name);

    if (found === tier) {
      return sets[tier].filter((mutator) => mutator.name === name);
    }

    const names = sets[tier].map((mutator) => mutator.name).join(', ');
    const hint = found === undefined ? `the names are ${names || 'none'}` : whereTiersGo[found];

    throw new Error(`${packageName}: no ${tierNames[tier]} mutator is named ${name}; ${hint}.`);
  };
  const selected = entriesOf(packageName, 'the options', options ?? {}).flatMap(([key, value]) => {
    if (key === 'experimental' && isRecord(value)) {
      return entriesOf(packageName, key, value).flatMap(([name, member]) => {
        onlyTrue(packageName, `experimental.${name}`, member);

        return named('experimental', name);
      });
    }

    onlyTrue(packageName, key, value);

    if (key === 'experimental') {
      return sets.experimental;
    }

    return key === 'extended' ? sets.optIn : named('optIn', key);
  });

  return lzAllMutators(sets).filter((mutator) => sets.defaults.includes(mutator) || selected.includes(mutator));
}

function isRecord(value: unknown): value is object {
  return isObject(value) && !Array.isArray(value);
}

function entriesOf(packageName: string, what: string, value: unknown): [string, unknown][] {
  if (!isRecord(value)) {
    throw new Error(`${packageName}: ${what} must be an object, not ${inspect(value)}.`);
  }

  return Object.keys(value).flatMap((key): [string, unknown][] => {
    const member: unknown = Reflect.get(value, key);

    return member === undefined ? [] : [[key, member]];
  });
}

function onlyTrue(packageName: string, key: string, value: unknown): void {
  if (value !== true) {
    throw new Error(
      `${packageName}: ${key} takes only true${key === 'experimental' ? ' or an object of names' : ''}, not ` +
        `${inspect(value)}; Stryker's mutator.excludedMutations turns mutators off.`,
    );
  }
}
