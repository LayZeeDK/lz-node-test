# @layzee/stryker-node-mutators

Extra [StrykerJS](https://stryker-mutator.io/) mutators for code that uses Node.js APIs and `node:assert`. It is ESM
only, needs Node.js 22.18 or later, and is tested on Node.js 22 and 24. It works with any Stryker test runner. To
mutate test files, use [`@layzee/stryker-node-test-mutators`](../stryker-node-test-mutators/README.md).

## Install

```sh
npm install --save-dev @stryker-mutator/core@^10.1.1 @layzee/stryker-node-mutators
```

`@stryker-mutator/core` and `@babel/core` are peer dependencies, and `@stryker-mutator/api` is a peer dependency of
`@layzee/stryker-mutator-core`, the package it installs its mutators through. The package adds its mutators
to the instrumenter of the Stryker that runs it. It accepts Stryker 10.1.1 or a later 10.x version and is tested with
10.1.1. The install checks that the instrumenter
makes a mutant of each added mutator from a sample, and stops the run with an error if it does not. With a
version of `@stryker-mutator/instrumenter` outside that range that passes the check, it logs a warning that mutants
may be missing: the check sees only the process that imports the configuration, and a Stryker release that
instruments in another process would leave the mutators out.

Stryker has no plugin kind for mutators, so this package is not a Stryker plugin. It changes the instrumenter's list of
mutators through two files that `@stryker-mutator/instrumenter` does not export, `dist/src/mutators/mutate.js` and
`dist/src/transformers/babel-transformer.js`. A Stryker release that moves or changes them stops the run with an error
that names the file, and this package then needs an update. Its warnings go to `console.warn`, as a configuration file
has no Stryker logger, so Stryker's `logLevel` and log file do not include them.

## Mutate production code

Import the package at the top of your Stryker configuration file. The import adds the mutators to Stryker's own:

```js
import '@layzee/stryker-node-mutators';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ['src/**/*.js'],
  // ...the rest of your configuration
};
```

Import it in the configuration file, not through `plugins`. Stryker only warns when a module in `plugins` fails to
load, while a failed import stops the run. The configuration file must be an ES module, such as `stryker.config.mjs`,
or `stryker.config.js` in a package with `"type": "module"`, as a JSON configuration cannot import a module.

| Mutator                 | What it changes                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LzNodeTimerDelay`      | Moves the delay of `setTimeout` and `setInterval`, from the globals, `node:timers` or `node:timers/promises`, by 1 ms each way. For a number literal, moves that leave a delay of 0 or 1 are left out, because Node.js runs a delay below 1 after 1 ms. A delay in a variable gets both moves, so a variable that holds 0 or 1 gives equivalent mutants: disable them with a reason. |
| `LzNodeEventName`       | Swaps a lifecycle event that a listener waits for with one that fires at another time, such as a child process's `exit` and `close`, or a stream's `finish`, `end` and `close`.                                                                                                                                                                                                      |
| `LzNodeAssertStatement` | Removes a `node:assert` statement. A survivor is an invariant that no test breaks.                                                                                                                                                                                                                                                                                                   |
| `LzNodeAwaitStatement`  | Removes a statement that only awaits a call, such as `await flush();`. Stryker removes a call statement but not an awaited one, so a lint rule that adds `await` to a floating promise would hide the call from mutation testing. As Stryker does for a call statement, it leaves a statement with another mutant inside it, such as `await flush('x');`.                            |
| `LzNodeReturnAwait`     | Turns `return await x` into `return x` inside a `try` block, where the `catch` and `finally` then no longer wait for `x`, and inside a `catch` block that a `finally` block follows. A survivor is a rejection or a cleanup whose timing no test sees. When `x` is never a promise, `return x` behaves the same, and the mutant is equivalent.                                       |
| `LzNodeExitCode`        | Flips the number that `process.exitCode = N` sets, from the global `process` or `node:process`: 0 becomes 1 and any other number 0. A survivor is an exit status that no test checks.                                                                                                                                                                                                |

An example mutant of each, in the form of Stryker's
[Supported mutators](https://stryker-mutator.io/docs/mutation-testing-elements/supported-mutators/) page:

| Mutator                 | Original                                           | Mutated                                      |
| ----------------------- | -------------------------------------------------- | -------------------------------------------- |
| `LzNodeTimerDelay`      | `setTimeout(retry, 100)`                           | `setTimeout(retry, 100 + 1)`                 |
| `LzNodeEventName`       | `child.on('exit', done)`                           | `child.on("close", done)`                    |
| `LzNodeAssertStatement` | `assert.ok(items.length > 0);`                     | `;`                                          |
| `LzNodeAwaitStatement`  | `await flush();`                                   | `;`                                          |
| `LzNodeReturnAwait`     | `try { return await load(); } catch { return 0; }` | `try { return load(); } catch { return 0; }` |
| `LzNodeExitCode`        | `process.exitCode = 0`                             | `process.exitCode = 1`                       |

`LzNodeExitCode` suits code that a test runs in a child process and whose exit code the test reads, such as a CLI.
Code that sets `process.exitCode` in the test's own process sets the exit code of the test run instead. With
`@layzee/stryker-node-test-runner`, the mutant that turns 0 into 1 then makes the test file exit with code 1 while
no test fails. Stryker reports that mutant as a `RuntimeError`, not as `Survived`. A mutant of an assignment that an
uncaught exception follows is an equivalent mutant, because Node.js then exits with code 1 whatever
`process.exitCode` holds.

## Turn a mutator off

The mutators' names work in Stryker's disable comments like Stryker's own mutators:

```js
// Stryker disable next-line LzNodeTimerDelay: the delay only spaces out retries
setTimeout(retry, 100);
```

A disable comment for `LzNodeAssertStatement` names `CallExpression` too. Stryker's `CallExpression` mutator removes a call
statement that no other mutant shares, so with the `LzNodeAssertStatement` mutant ignored, its removal of the statement
comes back:

```js
// Stryker disable next-line LzNodeAssertStatement,CallExpression: callers never pass an empty list
assert.ok(items.length > 0);
```

## Build node:assert mutators

`@layzee/stryker-node-mutators/bindings` exports `lzBuiltin`, `lzNodeAssert` and `lzAssertMethod`, which find calls
of `node:assert`, for packages that build mutators of them. Importing it installs no mutators.
