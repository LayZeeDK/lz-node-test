# @layzee/lz-stryker-node-test-mutators

Extra [StrykerJS](https://stryker-mutator.io/) mutators for code that uses Node.js APIs and `node:assert`, plus a set
for mutating test files. It is ESM only and needs Node.js 22.18 or later. It works with any Stryker test runner.

## Install

```sh
npm install --save-dev @stryker-mutator/core@^10.1.1 @layzee/lz-stryker-node-test-mutators
```

`@stryker-mutator/core`, `@stryker-mutator/api` and `@babel/core` are peer dependencies. The package adds its mutators
to the instrumenter of the Stryker that runs it. It accepts Stryker 10.1.1 or a later 10.x version and is tested with
10.1.1. The install checks that the instrumenter
makes a mutant of each added mutator from a sample, and stops the run with an error if it does not. With a
version of `@stryker-mutator/instrumenter` outside that range that passes the check, it logs a warning that mutants
may be missing: the check sees only the process that imports the configuration, and a Stryker release that
instruments in another process would leave the mutators out.

## Mutate production code

Import the package at the top of your Stryker configuration file. The import adds the mutators to Stryker's own:

```js
import '@layzee/lz-stryker-node-test-mutators';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ['src/**/*.js'],
  // ...the rest of your configuration
};
```

Import it in the configuration file, not through `plugins`. Stryker only warns when a module in `plugins` fails to
load, while a failed import stops the run.

| Mutator             | What it changes                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LzNodeTimerDelay`  | Moves the delay of `setTimeout` and `setInterval`, from the globals, `node:timers` or `node:timers/promises`, by 1 ms each way. Moves that leave a delay of 0 or 1 are left out, because Node.js runs a delay below 1 after 1 ms.                                                                                                                         |
| `LzNodeEventName`   | Swaps a lifecycle event that a listener waits for with one that fires at another time, such as a child process's `exit` and `close`, or a stream's `finish`, `end` and `close`.                                                                                                                                                                           |
| `LzAssertStatement` | Removes a `node:assert` statement. A survivor is an invariant that no test breaks.                                                                                                                                                                                                                                                                        |
| `LzAwaitStatement`  | Removes a statement that only awaits a call, such as `await flush();`. Stryker removes a call statement but not an awaited one, so a lint rule that adds `await` to a floating promise would hide the call from mutation testing. As Stryker does for a call statement, it leaves a statement with another mutant inside it, such as `await flush('x');`. |
| `LzReturnAwait`     | Turns `return await x` into `return x` inside a `try` block, where the `catch` and `finally` then no longer wait for `x`, and inside a `catch` block that a `finally` block follows. A survivor is a rejection or a cleanup whose timing no test sees.                                                                                                    |
| `LzNodeExitCode`    | Flips the number that `process.exitCode = N` sets, from the global `process` or `node:process`: 0 becomes 1 and any other number 0. A survivor is an exit status that no test checks.                                                                                                                                                                     |

## Mutate test files

To check that your tests' assertions can fail, mutate the test files in a configuration of their own. Import the
`test-code` entry instead. It replaces Stryker's mutators with these:

```js
import '@layzee/lz-stryker-node-test-mutators/test-code';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ['test/**/*.test.js'],
  // ...the rest of your configuration
};
```

| Mutator             | What it changes                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LzAssertCall`      | Makes an assertion fail. A survivor is a check whose failure nothing sees. A check that never runs comes out as `NoCoverage`.                                                                                                                                                                                                                                       |
| `LzAssertValidator` | Makes the code that `assert.throws` or `assert.rejects` checks throw an unrelated error, and so the test function of a node:test test whose `expectFailure` is a matcher, such as `{ expectFailure: /bad id/ }` or the `match` of `{ label, match }`. A string `expectFailure` is only a label and is left alone. A survivor is a validator that accepts any error. |

## Turn a mutator off

The mutators' names work in Stryker's disable comments like Stryker's own mutators:

```js
// Stryker disable next-line LzNodeTimerDelay: the delay only spaces out retries
setTimeout(retry, 100);
```
