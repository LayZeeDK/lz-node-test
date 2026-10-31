# @layzee/lz-stryker-node-test-runner

A [StrykerJS](https://stryker-mutator.io/) test runner for `node:test`. It runs each test file in its own `node`
process with `node:test`, so the tests run as they do under `node --test`. It is ESM only, needs Node.js 22.18 or
later, and is tested on Node.js 22 and 24.

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
`.js`, `.jsx`, `.ts` or `.tsx`, such as `app.spec.ts` or `app.test.js`, outside `node_modules`. The default also
matches files named only `spec` or `test`, such as `test.js` or a Karma `src/test.ts`, and built test files, such as
`dist/app.spec.js`. Set `testFiles` when such files sit in the working directory, or the runner runs them as test
files. Set it as well for other names, such as `.test.mjs` files.

Node.js strips the types of `.ts` test files itself, so no build step is needed, but it cannot run `.tsx` or `.jsx`
files: add a loader for them to `nodeArgs`. Add `@stryker-mutator/typescript-checker` and `checkers: ['typescript']`
to report mutants that do not compile as compile errors instead of running them.

## Options

All options sit under `lzStrykerNodeTest`.

| Option        | Type       | Default                               | Description                                                                                                                                                                                                                                                                                                      |
| ------------- | ---------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testFiles`   | `string[]` | `['**/?(*.)+(spec\|test).[jt]s?(x)']` | Glob patterns for the test files, relative to the working directory. `node_modules` is never searched. The default is Nx's test-file convention.                                                                                                                                                                 |
| `nodeArgs`    | `string[]` | `[]`                                  | Arguments for `node` ahead of the test file, such as `--enable-source-maps` or `--test-only`. Options that add a `node:test` reporter or its destination are left out, because the runner uses its own reporter. Without `--test-only`, `only` tests and suites run with all the others, as under `node --test`. |
| `maxMemoryMB` | `number`   | from the dry run                      | The memory in MB that each process of a mutant run may hold before the runner ends it and reports the mutant as timed out. The default is the most memory that a process of the test file held in the dry run, times 1.5, plus 1024.                                                                             |

`nodeArgs` reach the process of each test file. Stryker's own `testRunnerNodeArgs` reach Stryker's worker process,
which runs the runner but not the tests. To debug a test file, set `testFiles` to that file, run Stryker with
`--concurrency 1`, and pass `--inspect-brk` in `nodeArgs`. Each process of that file then waits for a debugger, one at
a time.

On Node.js 24, `--test-global-setup` in `nodeArgs` runs its setup and teardown once in each test file's process, not
once per run as under `node --test`.

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
  - When a test file's process exits, the runner ends the processes its tests left running. On Linux and macOS, it
    sends them SIGTERM and, when any is still running 200 ms later, SIGKILL. On Windows, the processes that the test
    file's process started directly end with it.
  - A process started with `detached: true` keeps running on every platform. On Windows, so does a process started
    through a shell, such as with `shell: true` or through a `.cmd` file.
- **The hook in every process.** Each `node` process that a test starts loads the runner's hook before its own code.
  In one measurement on a Windows arm64 machine where `node -e 0` took 80 ms, the hook added a few tens of
  milliseconds to that start with the runner's compile cache, a little more with the thread that watches memory, and
  about three times as much without a compile cache. The thread runs in each process of a mutant run, and of the dry run when `maxMemoryMB` is set. To start a process
  without the hook, give it an environment whose `NODE_OPTIONS` leaves out the runner's `--import`. What that process
  covers then counts for no test, so a mutant that only it reaches comes out as `NoCoverage`.
- **Tests run one at a time.** The runner registers every suite and test with `concurrency: false`, so that coverage
  goes to the one test that runs. A suite that sets `concurrency` takes as long as its tests together.
- **The dry run runs files in parallel.** It runs as many test files at once as Stryker later runs test runners for
  the mutants, so the test times include the slowdown of processes that share the cores. Each mutant run runs its
  test files one after another.
- **Test times include a share of the start of the process.** The time a file's process spent outside its tests,
  such as starting `node` and loading modules, is split equally among the file's tests, subtests included, because
  running one test of a file runs the file's whole process. Stryker sizes a mutant's timeout from the summed times of
  the tests it runs, so a mutant that runs all of a file's tests counts that start-up time once, and one that runs
  some of them counts their share of it. Stryker's `timeoutMS`, 5 seconds by default, covers the rest; raise it for
  test files whose processes take longer than that to start.
- **Output.** The runner discards each test file's stdout. It keeps the last 8 KiB of stderr and shows it when a file
  fails outside its tests.
- **Coverage analysis.** The runner supports Stryker's `coverageAnalysis` values `off`, `all` and `perTest`. With
  `perTest`, a mutant runs only the tests that reach it. A child process or worker thread that ends before the test
  that started it counts toward that test alone. One that keeps running after its test, such as a worker that the
  next test talks to, counts toward every test that ran while it lived, so its mutants run all of those tests. If it
  also lived while no test ran, such as between two tests, its mutants count as reached from outside any test as
  well: by default they then run every test of the run, and with Stryker's `ignoreStatic` they run the tests it
  lived through.
- **Bail.** Unless you set `disableBail`, a mutant run stops at the first failing test.
- **Node.js version.** On a Node.js older than 22.18, the runner stops with an error before the dry run.

## What each status means

The runner reports each test file's run to Stryker by the first row of this table that applies. A mutant run that
Stryker's own timeout ends first is a `Timeout`.

| What happened in the test file's run                                                                               | Dry run                       | Mutant run     |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------- | -------------- |
| A process held more memory than its limit                                                                          | error if `maxMemoryMB` is set | `Timeout`      |
| A results file of a process could not be read                                                                      | error                         | `RuntimeError` |
| The mutant's code ran more often than Stryker's hit limit allows                                                   | does not apply                | `Timeout`      |
| `node` exited with a code other than 0, and no test failed                                                         | error                         | `RuntimeError` |
| The test file's process wrote no results                                                                           | error                         | `RuntimeError` |
| No test failed, and the file stayed alive after its tests                                                          | error                         | `Timeout`      |
| No test failed, and the process exited before node:test reported every test, as when a test calls `process.exit()` | error                         | `RuntimeError` |
| A test failed                                                                                                      | Stryker stops: failed tests   | `Killed`       |
| Every test passed                                                                                                  | complete                      | `Survived`     |

Stryker counts a `Timeout` as detected. So a mutant that only makes a process hold more memory than its limit counts
as detected, though no test fails. To keep such mutants out of the detected ones, raise `maxMemoryMB`.

A mutant that makes a module throw while a test file loads it, before any test runs, is a `RuntimeError`, as in
Stryker's jest and mocha runners. Stryker leaves a `RuntimeError` out of the mutation score. Stryker's `command`
runner and its tap runner count the same mutant as `Killed`, so on such code this runner's score can be lower than
theirs while no test result differs.

## Close what your tests open

A test file whose tests leave something open, such as a listening server, keeps its process alive after its tests
end. The runner ends such a file once its tests and root `after` hooks have finished: at once if a test failed,
otherwise 30 seconds later. In the dry run, Stryker then reports an error that names the file and what held it open.
In a mutant run, the mutant counts as timed out.

To fix it, close what the tests open in an `after` hook. If you cannot, pass `--test-force-exit` in `nodeArgs`.
`NODE_OPTIONS` does not accept that flag. Under it, `node:test` loses errors that are raised after the tests and root
`after` hooks end.

## Run under the permission model

When the test files run under Node.js's permission model (`--permission`), give them two permissions:

- `--allow-fs-write` for the runner's run directories, `lz-stryker-node-test-*` in `os.tmpdir()`. Each process
  writes its results there. Without write access, every test file ends with "Missing test results".
- `--allow-worker`. Each process watches its memory from a worker thread. Without it, no memory limit applies, and
  `maxMemoryMB` has no effect.

## Temporary files

The runner keeps its run directories in `os.tmpdir()`, named `lz-stryker-node-test-*`, and removes them when the run
ends. The memory peaks of the dry run, `lz-stryker-node-test-peaks-<pid>-dry-run`, stay until Stryker's own process
exits, as the mutant runs read them. When Stryker is killed instead, the next run removes them, as it removes any
directory that a crashed run left behind. With `maxMemoryMB` set, the runner records no peaks.
