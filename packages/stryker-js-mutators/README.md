# @layzee/stryker-js-mutators

Extra [StrykerJS](https://stryker-mutator.io/) mutators for any JavaScript or TypeScript code: statements and literals
that Stryker's own mutators leave alone. It is ESM only, needs Node.js 22.18 or later, and is tested on Node.js 22
and 24. It works with any Stryker test runner.

## Install

```sh
npm install --save-dev @stryker-mutator/core@^10.1.1 @layzee/stryker-js-mutators
```

`@stryker-mutator/core` and `@babel/core` 8.0 (Stryker 10's Babel) are peer dependencies, and `@stryker-mutator/api` is
a peer dependency of `@layzee/stryker-mutator-core`, the package it installs its mutators through. It accepts Stryker
10.1.1 or a later 10.x version and is tested with 10.1.1.
