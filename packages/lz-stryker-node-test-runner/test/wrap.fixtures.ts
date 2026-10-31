import type { InstrumenterContext, Position } from '@stryker-mutator/api/core';

import type { RecordedTest } from '../src/record.ts';
import { wrapNodeTest, type CallSite } from '../src/wrap.ts';
import { bodyOf, fakeNodeTest, testContext, testFile, type Fn, type Registration } from './hook-core.fixtures.ts';

export async function runBodies(registrations: Registration[], names: string[]): Promise<void> {
  for (const name of names) {
    await bodyOf(registrations, name)(testContext());
  }
}

export interface Subtests {
  readonly test: (name: string, body: Fn) => unknown;
}

interface WrappedOptions {
  readonly filter?: readonly string[];
  readonly bail?: boolean;
  readonly activeMutant?: string;
  readonly expectFailure?: boolean;
}

export function wrapped({ filter, bail = false, activeMutant, expectFailure }: WrappedOptions = {}) {
  const fake = fakeNodeTest(expectFailure);
  const ns: InstrumenterContext = {};
  const env: Record<string, string | undefined> = {};
  const tests: RecordedTest[] = [];
  const seen: (string | undefined)[] = [];
  const positions = new Map<string, Position>();
  const sites: CallSite[] = [];
  /** Each call of `registering`: whether top-level, and how many registrations node:test had then. */
  const registering: [boolean, number][] = [];
  const rootAfters: unknown[] = [];
  const module = wrapNodeTest({
    ns,
    testFile: testFile,
    tests,
    filter: filter && new Set(filter),
    bail,
    activeMutant,
    env,
    positions,
    callSites: () => sites,
    nodeTest: fake.module,
    registering: (topLevel) => {
      registering.push([topLevel, fake.registrations.length]);
    },
    rootAfter: (hook) => {
      rootAfters.push(hook);

      return hook;
    },
  });

  const see = () => seen.push(ns.currentTestId);

  return {
    ...fake,
    original: fake.module,
    module,
    ns,
    env,
    tests,
    positions,
    sites,
    seen,
    see,
    registering,
    rootAfters,
  };
}
