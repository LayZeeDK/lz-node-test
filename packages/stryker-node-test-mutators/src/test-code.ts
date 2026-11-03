// A Stryker configuration file that mutates test files imports this module, so that an error in the install stops the
// run.
import { lzInstall } from '@layzee/stryker-mutator-core';
import { testOperators } from './operators.ts';
import { lzCorePeerRange, lzPackageName } from './package-name.ts';

await lzInstall({
  packageName: lzPackageName,
  corePeerRange: lzCorePeerRange,
  mode: 'replace',
  operators: testOperators,
});
