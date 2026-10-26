# @layzee/lz-stryker-node-test-runner

A [StrykerJS](https://stryker-mutator.io/) test runner for `node:test`. It runs each test file in its own `node`
process with `node:test`, so the tests run as they do under `node --test`. It is ESM only and needs Node.js 22.18 or
later.

- Stryker plugin name: `lz-stryker-node-test`
- Stryker options key: `lzStrykerNodeTest`

## Install

```sh
npm install --save-dev @stryker-mutator/core@~10.1.1 @layzee/lz-stryker-node-test-runner
```

`@stryker-mutator/core` and `@stryker-mutator/api` are peer dependencies. The runner supports Stryker 10.1.

## Configure Stryker

Load the plugin and select the runner in your Stryker configuration file, for example `stryker.config.mjs`:

```js
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ['src/**/*.js'],
  plugins: ['@stryker-mutator/*', '@layzee/lz-stryker-node-test-runner'],
  testRunner: 'lz-stryker-node-test',
  lzStrykerNodeTest: { testFiles: ['test/**/*.test.js'] },
  reporters: ['clear-text', 'progress'],
};
```

Keep `'@stryker-mutator/*'` in `plugins`, so that Stryker still loads its own plugins, such as the TypeScript checker.

To test TypeScript, point `testFiles` at the `.ts` test files. Node.js strips the types itself, so no build step is
needed. Add `@stryker-mutator/typescript-checker` and `checkers: ['typescript']` to report mutants that do not
compile as compile errors instead of running them.

## Options

All options sit under `lzStrykerNodeTest`.

| Option        | Type       | Default            | Description                                                                                                                                                                                                                          |
| ------------- | ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `testFiles`   | `string[]` | `['**/*.test.ts']` | Glob patterns for the test files, relative to the working directory. `node_modules` is never searched.                                                                                                                               |
| `nodeArgs`    | `string[]` | `[]`               | Arguments for `node` ahead of the test file, such as `--enable-source-maps` or `--test-only`. Options that add a `node:test` reporter or its destination are left out, because the runner uses its own reporter.                     |
| `maxMemoryMB` | `number`   | from the dry run   | The memory in MB that each process of a mutant run may hold before the runner ends it and reports the mutant as timed out. The default is the most memory that a process of the test file held in the dry run, times 1.5, plus 1024. |

## What the runner does

- **One process per test file.** Each file runs in a fresh `node` process, so a mutant cannot leak state from one file
  into another. Processes that a test starts, such as child processes and worker threads, load the runner's hook
  through `NODE_OPTIONS`, so the code under test that they run counts too.
- **Coverage analysis.** The runner supports Stryker's `coverageAnalysis` values `off`, `all` and `perTest`. With
  `perTest`, a mutant runs only the tests that reach it.
- **Bail.** Unless you set `disableBail`, a mutant run stops at the first failing test.
- **Node.js version.** On a Node.js older than 22.18, the runner stops with an error before the dry run.

## Close what your tests open

A test file whose tests leave something open, such as a listening server, keeps its process alive after its tests
end. The runner ends such a file once its tests and root `after` hooks have finished: at once if a test failed,
otherwise 30 seconds later. In the dry run, Stryker then reports an error that names the file and what held it open.
In a mutant run, the mutant counts as timed out.

To fix it, close what the tests open in an `after` hook. If you cannot, pass `--test-force-exit` in `nodeArgs`.
`NODE_OPTIONS` does not accept that flag. Under it, `node:test` loses errors that are raised after the tests and root
`after` hooks end.

## Temporary files

The runner keeps its run directories in `os.tmpdir()`, named `lz-stryker-node-test-*`, and removes them when the run
ends. A directory that a crashed run left behind is removed by the next run.
