# @layzee/stryker-mutator-core

The install layer that packages of [StrykerJS](https://stryker-mutator.io/) mutators share, such as
[`@layzee/stryker-node-mutators`](../stryker-node-mutators/README.md). It puts mutation operators into the
instrumenter of the Stryker that runs it, and has the Babel helpers that such operators use. It is ESM only, needs
Node.js 22.18 or later, and is tested on Node.js 22 and 24.

## Install

```sh
npm install @layzee/stryker-mutator-core
```

`@stryker-mutator/core`, `@stryker-mutator/api` and `@babel/core` are peer dependencies. Stryker has no plugin kind for
mutators, so a package of mutators calls `lzInstall` from a module that the Stryker configuration file imports:

```js
import { lzInstall } from '@layzee/stryker-mutator-core';

import { operators } from './operators.js';

await lzInstall({ packageName: 'my-mutators', corePeerRange: '^10.1.1', mode: 'add', operators });
```

- `packageName` starts each error and warning.
- `corePeerRange` is the calling package's peer range of `@stryker-mutator/core`, a caret range of a release.
- `mode` is `add`, which adds the operators to the mutators in the list, or `replace`, which first removes Stryker's
  mutators and the ones this package installed before. Both keep the mutators that other packages installed through
  `lzInstall`, and refuse an operator whose name, ignoring case, one of them or one of Stryker's already has.
- `operators` are `LzOperator` objects: a name of letters only, a sample module in which the operator makes a mutant,
  and a `mutate` function that maps a Babel path to replacement nodes.

`lzInstall` puts the operators into every copy of the instrumenter that the process may run, then instruments each
operator's sample with each copy and throws if one makes no mutant. With an instrumenter version outside
`corePeerRange` that passes that check, it logs a warning to `console.warn` that mutants may be missing. It changes the
instrumenter's list of mutators through two files that `@stryker-mutator/instrumenter` does not export,
`dist/src/mutators/mutate.js` and `dist/src/transformers/babel-transformer.js`. A Stryker release that moves or changes
them stops the run with an error that names the file.

### Opt-in and experimental operators

A package with operators that run only when a user turns them on groups them as `LzOperatorSets`: `defaults`, `optIn`
and `experimental`. `lzSelectOperators(packageName, sets, options)` returns the defaults and the operators that the
user's options turn on, in the order of the sets, and `lzAllOperators(sets)` returns them all. `LzMutatorOptions` types
the options: an opt-in name or `extended` for every opt-in operator, and `experimental` with `true` or an object of
experimental names. A name and `extended` take only `true`; `experimental` takes `true` or an object whose values are
`true`. The call throws on a name it does not know or a name in the wrong place.

```js
import { lzInstall, lzSelectOperators } from '@layzee/stryker-mutator-core';

import { defaults, experimental, optIn } from './operators.js';

const sets = { defaults, optIn, experimental };

export async function myMutators(options) {
  await lzInstall({
    packageName: 'my-mutators',
    corePeerRange: '^10.1.1',
    mode: 'add',
    operators: lzSelectOperators('my-mutators', sets, options),
  });
}
```

Every mutator that `lzInstall` puts into the list carries the symbol `Symbol.for('@layzee/stryker-mutator-core')`, with
the name of the package that installed it, and `lzIsOwn` tells such a mutator from one of Stryker's.
