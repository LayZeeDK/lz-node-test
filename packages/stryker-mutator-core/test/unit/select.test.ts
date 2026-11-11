import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import type { LzMutator } from '../../src/mutator.ts';
import { lzAllMutators, lzSelectMutators, type LzMutatorSets } from '../../src/select.ts';

const packageName = 'lz-sample-mutators';

function mutator(name: string): LzMutator {
  return { name, sample: `${name}();`, *mutate() {} };
}

const sets: LzMutatorSets = {
  defaults: [mutator('LzDefaultA'), mutator('LzDefaultB')],
  optIn: [mutator('LzOptInA'), mutator('LzOptInB')],
  experimental: [mutator('LzExperimentalA'), mutator('LzExperimentalB')],
};

function namesFor(options: unknown): string[] {
  return lzSelectMutators(packageName, sets, options).map(({ name }) => name);
}

describe('lzSelectMutators', () => {
  lzTestEach([
    ['no options', undefined, ['LzDefaultA', 'LzDefaultB']],
    ['empty options', {}, ['LzDefaultA', 'LzDefaultB']],
    ['every opt-in mutator', { extended: true }, ['LzDefaultA', 'LzDefaultB', 'LzOptInA', 'LzOptInB']],
    ['an opt-in mutator by name', { LzOptInB: true }, ['LzDefaultA', 'LzDefaultB', 'LzOptInB']],
    [
      'every opt-in mutator and one by name',
      { LzOptInB: true, extended: true },
      ['LzDefaultA', 'LzDefaultB', 'LzOptInA', 'LzOptInB'],
    ],
    [
      'every experimental mutator',
      { experimental: true },
      ['LzDefaultA', 'LzDefaultB', 'LzExperimentalA', 'LzExperimentalB'],
    ],
    [
      'an experimental mutator by name',
      { experimental: { LzExperimentalB: true } },
      ['LzDefaultA', 'LzDefaultB', 'LzExperimentalB'],
    ],
    ['no experimental mutator by name', { experimental: {} }, ['LzDefaultA', 'LzDefaultB']],
    [
      'no mutator for options left undefined',
      { LzOptInA: undefined, extended: undefined, experimental: { LzExperimentalA: undefined } },
      ['LzDefaultA', 'LzDefaultB'],
    ],
    [
      'no experimental mutator for experimental left undefined',
      { experimental: undefined },
      ['LzDefaultA', 'LzDefaultB'],
    ],
    [
      'opt-in and experimental mutators, in the order of the sets',
      { experimental: { LzExperimentalB: true }, LzOptInB: true, extended: true },
      ['LzDefaultA', 'LzDefaultB', 'LzOptInA', 'LzOptInB', 'LzExperimentalB'],
    ],
  ])('installs the defaults and %s', (_title, options, expected) => {
    assert.deepEqual(namesFor(options), expected);
  });

  lzTestEach([
    [
      'options that are not an object',
      'extended',
      "lz-sample-mutators: the options must be an object, not 'extended'.",
    ],
    [
      'options that are an array',
      ['LzOptInA'],
      "lz-sample-mutators: the options must be an object, not [ 'LzOptInA' ].",
    ],
    [
      'a value JSON cannot print',
      { LzOptInA: 1n },
      "lz-sample-mutators: LzOptInA takes only true, not 1n; Stryker's mutator.excludedMutations turns mutators off.",
    ],
    [
      'false for a mutator',
      { LzOptInA: false },
      "lz-sample-mutators: LzOptInA takes only true, not false; Stryker's mutator.excludedMutations turns mutators off.",
    ],
    [
      'an object for a mutator',
      { LzOptInA: { LzExperimentalA: true } },
      'lz-sample-mutators: LzOptInA takes only true, not { LzExperimentalA: true }; ' +
        "Stryker's mutator.excludedMutations turns mutators off.",
    ],
    [
      'false for every opt-in mutator',
      { extended: false },
      "lz-sample-mutators: extended takes only true, not false; Stryker's mutator.excludedMutations turns mutators off.",
    ],
    [
      'false for an experimental mutator',
      { experimental: { LzExperimentalA: false } },
      'lz-sample-mutators: experimental.LzExperimentalA takes only true, not false; ' +
        "Stryker's mutator.excludedMutations turns mutators off.",
    ],
    [
      'false for every experimental mutator',
      { experimental: false },
      'lz-sample-mutators: experimental takes only true or an object of names, not false; ' +
        "Stryker's mutator.excludedMutations turns mutators off.",
    ],
    [
      'an array of experimental names',
      { experimental: ['LzExperimentalA'] },
      "lz-sample-mutators: experimental takes only true or an object of names, not [ 'LzExperimentalA' ]; " +
        "Stryker's mutator.excludedMutations turns mutators off.",
    ],
    [
      'an unknown name',
      { LzOptInC: true },
      'lz-sample-mutators: no opt-in mutator is named LzOptInC; the names are LzOptInA, LzOptInB.',
    ],
    [
      'an unknown experimental name',
      { experimental: { LzExperimentalC: true } },
      'lz-sample-mutators: no experimental mutator is named LzExperimentalC; the names are LzExperimentalA, LzExperimentalB.',
    ],
    [
      'a default mutator by name',
      { LzDefaultA: true },
      'lz-sample-mutators: no opt-in mutator is named LzDefaultA; it runs by default.',
    ],
    [
      'an experimental mutator outside experimental',
      { LzExperimentalA: true },
      'lz-sample-mutators: no opt-in mutator is named LzExperimentalA; it is experimental, so it goes inside experimental.',
    ],
    [
      'an opt-in mutator inside experimental',
      { experimental: { LzOptInA: true } },
      'lz-sample-mutators: no experimental mutator is named LzOptInA; it is opt-in, so it goes outside experimental.',
    ],
  ])('throws on %s', (_title, options, message) => {
    assert.throws(() => namesFor(options), { message });
  });

  it('lists every mutator, the defaults first', () => {
    assert.deepEqual(
      lzAllMutators(sets).map(({ name }) => name),
      ['LzDefaultA', 'LzDefaultB', 'LzOptInA', 'LzOptInB', 'LzExperimentalA', 'LzExperimentalB'],
    );
  });

  it('names no mutators when a set is empty', () => {
    assert.throws(() => lzSelectMutators(packageName, { ...sets, experimental: [] }, { experimental: { LzX: true } }), {
      message: 'lz-sample-mutators: no experimental mutator is named LzX; the names are none.',
    });
  });
});
