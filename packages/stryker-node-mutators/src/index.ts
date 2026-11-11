import { lzInstall, lzSelectMutators, type LzMutatorOptions } from '@layzee/stryker-mutator-core';
import { nodeMutatorSets } from './mutators.ts';
import { lzCorePeerRange, lzPackageName } from './package-name.ts';

/** The mutators that run only when a config turns them on, by name or all with `extended`. */
export type LzNodeOptInMutator = (typeof nodeMutatorSets.optIn)[number]['name'];

/** The mutators measured on too few projects to run by default, turned on inside `experimental`. */
export type LzNodeExperimentalMutator = (typeof nodeMutatorSets.experimental)[number]['name'];

export type LzNodeMutatorOptions = LzMutatorOptions<LzNodeOptInMutator, LzNodeExperimentalMutator>;

/**
 * Installs this package's mutators into Stryker: the defaults and those `options` turns on. A Stryker configuration file
 * awaits it, so that an error in the install stops the run; Stryker only warns when a module in `plugins` fails to load.
 */
export async function lzNodeMutators(options?: LzNodeMutatorOptions): Promise<void> {
  await lzInstall({
    packageName: lzPackageName,
    corePeerRange: lzCorePeerRange,
    mode: 'add',
    mutators: lzSelectMutators(lzPackageName, nodeMutatorSets, options),
  });
}
