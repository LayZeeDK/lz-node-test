import { lzInstall, lzSelectOperators, type LzMutatorOptions } from '@layzee/stryker-mutator-core';
import { testOperatorSets } from './operators.ts';
import { lzCorePeerRange, lzPackageName } from './package-name.ts';

/** The mutators measured on too few projects to run by default, turned on inside `experimental`. */
export type LzNodeTestExperimentalMutator = 'LzNodeTestCatchAssert';

export type LzNodeTestMutatorOptions = LzMutatorOptions<never, LzNodeTestExperimentalMutator>;

/**
 * Replaces Stryker's mutators with this package's mutators for test code: the defaults and those `options` turns on. A
 * Stryker configuration file that mutates test files awaits it, so that an error in the install stops the run; Stryker
 * only warns when a module in `plugins` fails to load.
 */
export async function lzNodeTestMutators(options?: LzNodeTestMutatorOptions): Promise<void> {
  await lzInstall({
    packageName: lzPackageName,
    corePeerRange: lzCorePeerRange,
    mode: 'replace',
    operators: lzSelectOperators(lzPackageName, testOperatorSets, options),
  });
}
