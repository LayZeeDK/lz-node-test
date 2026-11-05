# @layzee/stryker-node-test-mutators

[StrykerJS](https://stryker-mutator.io/) mutators for mutating test files that use `node:assert` and `node:test`. It
is ESM only, needs Node.js 22.18 or later, and is tested on Node.js 22 and 24. It works with any Stryker test runner.
To mutate production code, use [`@layzee/stryker-node-mutators`](../stryker-node-mutators/README.md).

## Install

```sh
npm install --save-dev @stryker-mutator/core@^10.1.1 @layzee/stryker-node-test-mutators
```

`@stryker-mutator/core` and `@babel/core` 8.0 (Stryker 10's Babel) are peer dependencies, and `@stryker-mutator/api` is a peer dependency of
`@layzee/stryker-mutator-core`, the package it installs its mutators through. The package puts its mutators into the
instrumenter of the Stryker that runs it. It accepts Stryker 10.1.1 or a later 10.x version and is tested with
10.1.1. The install checks that the instrumenter makes a mutant of each mutator from a sample, and stops the run with
an error if it does not. With a version of `@stryker-mutator/instrumenter` outside that range that passes the check,
it logs a warning that mutants may be missing.

Stryker has no plugin kind for mutators, so this package is not a Stryker plugin; see
[`@layzee/stryker-node-mutators`](../stryker-node-mutators/README.md) for how the install changes the instrumenter's
list of mutators.

## Mutate test files

To check that your tests' assertions can fail, mutate the test files in a configuration of their own. Call
`lzNodeTestMutators` at the top of it. It replaces Stryker's mutators with the default mutators below:

```js
import { lzNodeTestMutators } from '@layzee/stryker-node-test-mutators';

await lzNodeTestMutators();

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ['test/**/*.test.js'],
  testRunner: 'lz-node-test',
  appendPlugins: ['@layzee/stryker-node-test-runner'],
  lzNodeTest: { testFiles: ['test/**/*.test.js'] },
  // ...the rest of your configuration
};
```

The mutated test files are also the files the test runner runs, so a mutant in a test is run by that test.

Call it in the configuration file, not through `plugins`. Stryker only warns when a module in `plugins` fails to
load, while a failed call stops the run.

Experimental mutators run only when the options turn them on: all of them with `experimental: true`, or one by its
name, as in `await lzNodeTestMutators({ experimental: { LzNodeTestCatchAssert: true } })`. The options work as in
[`@layzee/stryker-node-mutators`](../stryker-node-mutators/README.md#opt-in-and-experimental-mutators); this package
has no opt-in mutators yet, so `extended: true` turns on nothing.

`LzNodeTestAssertCall` and `LzNodeTestAssertValidator` find `node:assert` and `node:test` through an ES module
`import`, not a CommonJS `require`, so a CommonJS test file gets no mutant from them. `LzNodeTestCatchAssert` finds
assertions by name and also counts a `require`d `assert`.

### Default mutators

| Mutator                     | What it changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LzNodeTestAssertCall`      | Makes an assertion fail. A survivor is a check whose failure nothing sees. A check that never runs comes out as `NoCoverage`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `LzNodeTestAssertValidator` | Makes the code that `assert.throws` or `assert.rejects` checks throw an unrelated error, and so the test function of a node:test test whose `expectFailure` is a matcher, such as `{ expectFailure: /bad id/ }` or the `match` of `{ label, match }`. A string, a boolean, a number or any other expression that is not a RegExp, function, class, object, variable or member is only a label and is left alone. A test made through `it.only` counts; a `skip` or `todo` test, or one whose options spread another object, is left alone, as its mutant would survive whatever the matcher. A survivor is a validator that accepts any error. |

An example mutant of each:

| Mutator                     | Original                                  | Mutated                                                                      |
| --------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| `LzNodeTestAssertCall`      | `assert.equal(total, 3);`                 | `{ assert.equal(total, 3); throw new Error("Stryker: assertion reached"); }` |
| `LzNodeTestAssertValidator` | `assert.throws(() => parse(''), /empty/)` | `assert.throws(() => { throw new Error("Stryker"); }, /empty/)`              |

### Experimental mutators

| Mutator                 | What it changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LzNodeTestCatchAssert` | Empties the `try` block of a `try`/`catch` whose `catch` asserts and throws nothing. A survivor is a test that passes when the code under test stops throwing; `assert.throws`, `assert.rejects` or a plan would catch it. Assertions are found by name, so a `require`d `assert` counts, and functions inside the `catch` are not searched. A `try` block that ends in a `throw` or an `assert.fail(...)` is left alone, as its test already fails when the code stops throwing. |

| Mutator                 | Original                                                 | Mutated                                      |
| ----------------------- | -------------------------------------------------------- | -------------------------------------------- |
| `LzNodeTestCatchAssert` | `try { parse(''); } catch (error) { assert.ok(error); }` | `try {} catch (error) { assert.ok(error); }` |

The mutators' names work in Stryker's disable comments like Stryker's own mutators.
