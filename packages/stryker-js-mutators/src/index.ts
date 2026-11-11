import { lzInstall, lzSelectMutators, type LzMutatorOptions } from '@layzee/stryker-mutator-core';
import { jsMutatorSets } from './mutators.ts';
import { lzCorePeerRange, lzPackageName } from './package-name.ts';

/** The mutators that run only when a config turns them on, by name or all with `extended`. */
export type LzJsOptInMutator = (typeof jsMutatorSets.optIn)[number]['name'];

/** The mutators measured on too few projects to run by default, turned on inside `experimental`. */
export type LzJsExperimentalMutator = (typeof jsMutatorSets.experimental)[number]['name'];

export type LzJsMutatorOptions = LzMutatorOptions<LzJsOptInMutator, LzJsExperimentalMutator>;

/**
 * Installs this package's mutators into Stryker: the defaults and those `options` turns on. A Stryker configuration file
 * awaits it, so that an error in the install stops the run; Stryker only warns when a module in `plugins` fails to load.
 */
export async function lzJsMutators(options?: LzJsMutatorOptions): Promise<void> {
  await lzInstall({
    packageName: lzPackageName,
    corePeerRange: lzCorePeerRange,
    mode: 'add',
    mutators: lzSelectMutators(lzPackageName, jsMutatorSets, options),
  });
}
