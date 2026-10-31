# @layzee/lz-stryker-node-test-runner

A [StrykerJS](https://stryker-mutator.io/) test runner for `node:test`. It runs each test file in its own `node`
process with `node:test`, so the tests run as they do under `node --test`. It is ESM only and needs Node.js 22.18 or
later.

- Stryker plugin name: `lz-stryker-node-test`
- Stryker options key: `lzStrykerNodeTest`

## Install

```sh
npm install --save-dev @stryker-mutator/core@^10.1.1 @layzee/lz-stryker-node-test-runner
```

`@stryker-mutator/core` and `@stryker-mutator/api` are peer dependencies. The runner accepts Stryker 10.1.1 or a later
10.x version and is tested with 10.1.1.

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

By default, the runner runs the test files that Nx's convention names: every `.spec` or `.test` file that ends in
`.js`, `.jsx`, `.ts` or `.tsx`, such as `app.spec.ts` or `app.test.js`, outside `node_modules`. Set `testFiles` for
other names, such as `.test.mjs` files. Node.js strips the types of `.ts` test files itself, so no build step is
needed. Add `@stryker-mutator/typescript-checker` and `checkers: ['typescript']` to report mutants that do not
compile as compile errors instead of running them.

## Options

All options sit under `lzStrykerNodeTest`.

| Option        | Type       | Default                               | Description                                                                                                                                                                                                                          |
| ------------- | ---------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `testFiles`   | `string[]` | `['**/?(*.)+(spec\|test).[jt]s?(x)']` | Glob patterns for the test files, relative to the working directory. `node_modules` is never searched. The default is Nx's test-file convention.                                                                                     |
| `nodeArgs`    | `string[]` | `[]`                                  | Arguments for `node` ahead of the test file, such as `--enable-source-maps` or `--test-only`. Options that add a `node:test` reporter or its destination are left out, because the runner uses its own reporter.                     |
| `maxMemoryMB` | `number`   | from the dry run                      | The memory in MB that each process of a mutant run may hold before the runner ends it and reports the mutant as timed out. The default is the most memory that a process of the test file held in the dry run, times 1.5, plus 1024. |

## What the runner does

- **One process per test file.** Each file runs in a fresh `node` process, so a mutant cannot leak state from one file
  into another. Processes that a test starts, such as child processes and worker threads, load the runner's hook
  through `NODE_OPTIONS`, so the code under test that they run counts too, by these rules:
  - A process that ends by itself or through `process.exit()` counts in full. So does one that SIGTERM, SIGINT or
    SIGHUP ends on Linux or macOS, such as `child.kill()` sends; it still ends by that signal, unless it listens for
    the signal itself.
  - A worker thread that `worker.terminate()` ends, and on Windows a child process that anything ends, counts up to
    its last write: in the dry run, each such process writes its coverage every 250 ms.
  - Lost: what such a process covered in its last 250 ms, what a process that SIGKILL ends covered since its last
    write, and what a process whose event loop is busy when it is ended covered since its last write.
  - When a test file's process exits, the runner ends the processes its tests left running: on Linux and macOS with
    SIGTERM and, when any is still running 200 ms later, SIGKILL; on Windows at once.
- **Coverage analysis.** The runner supports Stryker's `coverageAnalysis` values `off`, `all` and `perTest`. With
  `perTest`, a mutant runs only the tests that reach it. A child process or worker thread that ends before the test
  that started it counts toward that test alone. One that keeps running after its test, such as a worker that the
  next test talks to, counts toward every test that ran while it lived, so its mutants run all of those tests. If it
  also lived while no test ran, such as between two tests, its mutants count as reached from outside any test as
  well: by default they then run every test of the run, and with Stryker's `ignoreStatic` they run the tests it
  lived through.
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
ends. The memory peaks of the dry run, `lz-stryker-node-test-peaks-<pid>-dry-run`, stay until Stryker's own process
exits, as the mutant runs read them. When Stryker is killed instead, the next run removes them, as it removes any
directory that a crashed run left behind. With `maxMemoryMB` set, the runner records no peaks.
