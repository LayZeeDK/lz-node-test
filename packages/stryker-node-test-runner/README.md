# @layzee/stryker-node-test-runner

A [StrykerJS](https://stryker-mutator.io/) test runner for `node:test`. It runs each test file in its own `node`
process with `node:test`, so the tests run as they do under `node --test`. It is ESM only, needs Node.js 22.18 or
later, and is tested on Node.js 22 and 24.

- Stryker plugin name: `lz-node-test`
- Stryker options key: `lzNodeTest`

## Quick start

Run StrykerJS's initializer, which installs Stryker and the runner and writes the configuration. Then run Stryker:

```sh
npm init stryker@latest
npx stryker run
```

With pnpm:

```sh
pnpm create stryker@latest
pnpm exec stryker run
```

Answer the initializer's questions as follows:

1. For the preset, pick `None/other`.
2. For the test runner, pick `@layzee/node`. The initializer names each runner after its package: it removes
   `@stryker-mutator/` and the first `stryker-` from the package name, then keeps the text before the first hyphen.
   The configuration that it writes still names the runner `lz-node-test` and loads this package through
   `appendPlugins`.
3. For the build command, keep the default, `none`, unless your tests need a build.

The other questions ask for the reporters, the package manager, and the configuration file type. Answer them as you
like. Then read the configuration file that the initializer wrote. When the default pattern does not match your test
files, add `lzNodeTest.testFiles`, as [Configure Stryker](#configure-stryker) describes.

With pnpm, the initializer also lists this package in `plugins`. Keep both `plugins` and `appendPlugins`.

If the initializer warns `Could not fetch additional initialization config`, it writes `testRunner: "@layzee/node"`
and no `appendPlugins`, and Stryker then fails with `Cannot find TestRunner plugin`. Set
`testRunner: 'lz-node-test'` and `appendPlugins: ['@layzee/stryker-node-test-runner']` by hand, as
[Configure Stryker](#configure-stryker) shows.

## Install

```sh
npm install --save-dev @stryker-mutator/core@^10.1.1 @layzee/stryker-node-test-runner
```

`@stryker-mutator/core` and `@stryker-mutator/api` are peer dependencies. The runner accepts Stryker 10.1.1 or a later
10.x version and is tested with 10.1.1.

## Configure Stryker

Load the plugin and select the runner in your Stryker configuration file, for example `stryker.config.mjs`:

```js
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ['src/**/*.js'],
  appendPlugins: ['@layzee/stryker-node-test-runner'],
  testRunner: 'lz-node-test',
  lzNodeTest: { testFiles: ['test/**/*.test.js'] },
  reporters: ['clear-text', 'progress'],
};
```

`appendPlugins` adds the runner to the plugins that Stryker loads by default, so Stryker still loads its own plugins,
such as the TypeScript checker. The initializer writes the same option.

By default, the runner runs the test files that Nx's convention names: every `.spec` or `.test` file that ends in
`.js`, `.jsx`, `.ts` or `.tsx`, such as `app.spec.ts` or `app.test.js`, outside `node_modules`. The default also
matches files named only `spec` or `test`, such as `test.js` or a Karma `src/test.ts`, and built test files, such as
`dist/app.spec.js`. Set `testFiles` when such files sit in the working directory, or the runner runs them as test
files. Set it as well for other names, such as `.test.mjs` files.

Stryker has a `testFiles` option of its own, `--testFiles` on the command line, apart from
`lzNodeTest.testFiles`. The runner looks for the files that either option matches. When Stryker's `testFiles`
is set, the dry run runs only those files, and Stryker runs only their tests for each mutant.

When no file matches, the runner stops before the dry run with the error `No test files match`, followed by the
patterns. With Stryker's `allowEmpty: true`, the runner logs that message as a warning instead and runs no tests.

Add `@stryker-mutator/typescript-checker` and `checkers: ['typescript']` to report mutants that do not compile as
compile errors instead of running them.

### TypeScript, JSX and loaders

Node.js strips the types of `.ts` test files itself, so the runner needs no build step for code that type stripping
can run. Type stripping has these limits, checked on Node.js 22.23.1 and 24.18.1:

- It reads no `tsconfig.json`. An import through a `paths` alias, such as `@app/util`, fails with
  `ERR_MODULE_NOT_FOUND`, because Node.js looks for a package of that name.
- It removes types and nothing else. An `enum`, a `namespace` that holds code, or a parameter property such as
  `constructor(private name: string)` fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
- It imports the file that the import names. `import './util.js'` does not find `util.ts` and fails with
  `ERR_MODULE_NOT_FOUND`. Write `import './util.ts'` instead.
- It does not run `.tsx` or `.jsx` files. They fail with `ERR_UNKNOWN_FILE_EXTENSION`.

Each of these errors fails the dry run. For such code, add a loader to `nodeArgs`, for example
[tsx](https://tsx.is/):

```js
lzNodeTest: { nodeArgs: ['--import', 'tsx'] },
```

The runner starts a new `node` process for each test file of each mutant run, and the loader compiles the file and its
imports again in each of them. To compile once instead, let Stryker build the code and run the built test files:

```js
buildCommand: 'tsc -b',
lzNodeTest: { testFiles: ['dist/**/*.spec.js'] },
```

Stryker runs `buildCommand` in its sandbox after it places the mutants in the code.

## Options

All options sit under `lzNodeTest`.

| Option        | Type       | Default                               | Description                                                                                                                                                                                                                                                                                                      |
| ------------- | ---------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testFiles`   | `string[]` | `['**/?(*.)+(spec\|test).[jt]s?(x)']` | Glob patterns for the test files, relative to the working directory. `node_modules` is never searched. The default is Nx's test-file convention.                                                                                                                                                                 |
| `nodeArgs`    | `string[]` | `[]`                                  | Arguments for `node` ahead of the test file, such as `--enable-source-maps` or `--test-only`. Options that add a `node:test` reporter or its destination are left out, because the runner uses its own reporter. Without `--test-only`, `only` tests and suites run with all the others, as under `node --test`. |
| `maxMemoryMB` | `number`   | from the dry run                      | The memory in MB that each process of a mutant run may hold before the runner ends it and reports the mutant as timed out. The default is the most memory that a process of the test file held in the dry run, times 1.5, plus 1024.                                                                             |

`nodeArgs` reach the process of each test file. Stryker's own `testRunnerNodeArgs` reach Stryker's worker process,
which runs the runner but not the tests. To debug a test file, set `lzNodeTest.testFiles` to that file, run
Stryker with `--concurrency 1`, and pass `--inspect-brk` in `nodeArgs`. Each process of that file then waits for a
debugger, one at a time.

To see each `node` command that the runner starts, and the folder it starts it in, run Stryker with
`--logLevel debug`.

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
    A lost hit can make a mutant that another test also reaches come out Survived, as Stryker then runs only that
    other test.
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
- **Test times include the start of the process.** Each test's time includes the time its file's process spent
  outside the file's tests, such as starting `node` and loading modules, because running one test of a file runs the
  file's whole process. Stryker sizes a mutant's timeout from the times of the tests it runs, so its timeout counts a
  file's start-up once for each test of that file that the mutant runs.
- **The runner's own deadline.** A mutant run starts each test file once, so the runner ends the run sooner than
  Stryker's timeout: once Stryker's timeout, less `timeoutFactor` times each file's start-up for each of its tests
  after the first, has passed. What is left still holds the tests' own time and each file's start-up once, with
  Stryker's `timeoutFactor` and `timeoutMS`. A run that ends this way is a `Timeout` that names the deadline, and
  Stryker keeps the worker running. A mutant that runs one test of each file gets Stryker's timeout unchanged.
  The runner measures each file's start-up in the dry run. A file without a measured start-up, such as one that
  Stryker's `--testFiles` left out of the dry run, keeps Stryker's timeout, and the runner warns about it once.
- **A test left pending.** When a test file's event loop empties while a test is still pending, Node.js 22 cancels
  the test, and Node.js 24 waits for it, as an unref'd timer or process may still settle it. In a mutant run, the
  runner ends such a file when no test result follows within Stryker's `timeoutMS`; the mutant is then a `Timeout`.
- **Output.** The runner discards each test file's stdout. It keeps the last 8 KiB of stderr and shows it when a file
  fails outside its tests.
- **Coverage analysis.** The runner supports Stryker's `coverageAnalysis` values `off`, `all` and `perTest`. With
  `perTest`, a mutant runs only the tests that reach it. A child process or worker thread that ends before the test
  that started it counts toward that test alone. One that keeps running after its test, such as a worker that the
  next test talks to, counts toward every test that ran while it lived, so its mutants run all of those tests. If it
  also lived while no test ran, such as between two tests, its mutants count as reached from outside any test as
  well: by default they then run every test of the run, and with Stryker's `ignoreStatic` they run the tests it
  lived through. In the test file's own process, a callback that runs after its test ended, such as one passed to
  `process.nextTick` or `setTimeout`, counts toward the test that is running when it runs, often the next one. Its
  mutants then run that test, not the one that scheduled the callback, and can survive although `node --test` fails.
  Stryker's runners for Jest and Vitest also count each hit toward the test running at the time. With `coverageAnalysis: 'all'`, every
  mutant that tests reach runs every test.
- **Static mutants.** Stryker calls a mutant static when code outside every test reaches it, such as the code that
  sets a module-level constant. A static mutant runs every test file, each in a fresh process. The mutant is active
  from the start of each process, also when Stryker's `--testFiles` limits the run. To skip static mutants, set
  Stryker's `ignoreStatic: true`. `ignoreStatic` needs `coverageAnalysis: 'perTest'`. Stryker reports the skipped
  mutants as `Ignored` and leaves them out of the mutation score. With `ignoreStatic`, a static mutant that tests also
  reach is not skipped: it runs those tests.
- **Bail.** Unless you set `disableBail`, a mutant run stops at the first failing test. With `disableBail`, a mutant
  whose tests failed in one test file is `Killed` by those tests also when a later file of its run times out.
- **Incremental mode.** The runner reports each test with its file and its position in that file. That is the "Full"
  level of test reporting in Stryker's incremental mode: after a change to a test file, Stryker runs again only the
  mutants that the changed tests cover. For a test file that the configuration also mutates, the runner reports the
  file but no position, because Stryker rewrites such a file in its sandbox and the positions no longer match your
  file. That is the partial level "Tests per file without location": after any change to such a file, Stryker runs
  again the mutants that any of its tests cover. [Use incremental mode](#use-incremental-mode) lists what Stryker does
  not see.
- **Node.js version.** On a Node.js older than 22.18, the runner stops with an error before the dry run.

## What each status means

The runner reports each test file's run to Stryker by the first row of this table that applies. When Stryker's own
timer ends a mutant run first, the mutant is a `Timeout` with no reason, and Stryker restarts the worker process that
ran it. When the runner's own deadline ends it first, the mutant is a `Timeout` whose reason names the deadline, and
the worker keeps running. A `Timeout` from this table names its reason too, and the worker keeps running. In a mutant
run, a test file that stays alive after its tests usually meets one of those deadlines before the runner's 30-second
wait ends.

| What happened in the test file's run                                                                               | Dry run                       | Mutant run     |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------- | -------------- |
| A process held more memory than its limit                                                                          | error if `maxMemoryMB` is set | `Timeout`      |
| A results file of a process could not be read                                                                      | error                         | `RuntimeError` |
| A test was still pending `timeoutMS` after the event loop emptied, with no test result since                       | does not apply                | `Timeout`      |
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

## What a run costs

The numbers below come from one Windows 11 ARM64 machine with 12 cores, on Node.js 24.18.1. They show where the time
goes, not how long your run takes.

Most of a mutant run's time is the start of a `node` process for each test file that the mutant runs. In a benchmark of
the runner with small test files:

- A mutant run of one test file took 163 ms. A bare `node` process that runs one test took 112 ms, so about 50 ms was
  the runner's own work for the file. The benchmark loaded the runner from its TypeScript source, so the 50 ms also
  holds the type stripping of the runner's hook, which the published JavaScript does not need.
- Each further test file in a mutant run added about 175 ms. Three files took 514 ms.

With `coverageAnalysis: 'perTest'`, Stryker's default, a mutant runs only the test files whose tests reach it.

Two open-source projects, each run 5 times a side at concurrency 5, against Stryker's `command` runner with
`node --test`. The restartable times were measured without the deadline that the fastify-cookie paragraph below
describes.

| Project               | Mutants | This runner, median | `command` runner, median |
| --------------------- | ------- | ------------------- | ------------------------ |
| restartable 3.0.4     | 167     | 53.5 s              | 166.0 s                  |
| fastify-cookie 11.1.3 | 246     | 35.7 s              | 48.5 s                   |

On restartable, the `command` runner runs the whole test suite for every mutant, and 36 to 37 mutants a run hang until
Stryker's timeout ends them. This runner runs only the tests that reach each mutant. Both restartable times include the
port collisions that the next section describes.

On fastify-cookie, 7 mutants make a test hang on both runners. This runner ends such a mutant run at its own deadline,
which counts each test file's start-up time once, so it does not wait for Stryker's timer. In 4 of the 5 runs, both
runners gave every mutant the same status. In the other, 2 mutants that this runner killed timed out on the `command`
runner, in that runner's slowest run.

## Use incremental mode

With `--incremental`, Stryker stores each mutant's result and, on the next run, reuses the results of mutants whose
code and tests did not change. Give each Stryker configuration its own `incrementalFile`: each run reads and rewrites
the whole file, so a configuration that shares it would read another configuration's results as its own.

On a configuration that mutates the `@layzee/node-test-extensions` package's source (349 mutants, concurrency 6, median of 5
runs a side, Windows 11 ARM64, Node.js 24.18.1, Stryker 10.1.1):

| Change since the stored run | Full run | Incremental run | Results reused |
| --------------------------- | -------- | --------------- | -------------- |
| None                        | 143 s    | 7.5 s           | 349 of 349     |
| One source file edited      | 143 s    | 7.4 s           | 348 of 349     |
| One test edited             | 143 s    | 22 s            | 261 of 349     |

The dry run always runs, and so does the TypeScript checker's first compile when you use it. The rest of the time goes
to mutants that run again.

Stryker compares only the files it mutates and the test files. In these cases an incremental run can reuse a result
that a full run would change. Run `stryker run --incremental --force` after any of them:

- A change to a file that is neither mutated nor a test file: a helper module that tests import, source that the
  configuration does not mutate, the Stryker configuration, the version of this runner or of Stryker, Node.js, or an
  environment variable.
- A change to code in a test file outside every test, such as a constant above the first test that a test reads.
  Stryker gives each test the lines from its own start to the next test's start, so such lines belong to no test.
- A change to a test so that it kills a static mutant. Stryker records no covering tests for a static mutant, so it
  never sees the change ([stryker-js#6119](https://github.com/stryker-mutator/stryker-js/issues/6119)).
- A test file whose first line is a block comment, such as a license header. Stryker shifts that file's test
  positions by one line, so an edit on a test's first line counts as an edit to the test before it. Starting the file
  with `//` line comments avoids the shift.

These cases cost time but give the same results:

- A test whose title the code under test builds. When a mutant changes the title of the test that kills it, Stryker
  cannot match that test on the next run, so the mutant runs again every time. Table titles such as
  `lzTestEach(rows)('says %d is adult: %s', ...)` are stable when the rows hold literal values. A row that calls the
  code under test, such as `[30, isAdult(30)]`, puts that code's result in the title. Such code runs while the test
  file registers its tests, so its mutants are static and run every test. The test still runs and still kills the
  mutant, but under a name the stored results lack. Stryker's Vitest runner names tests by their titles too and does
  the same. In one project, 14 such mutants made an incremental run on an unchanged tree take 32 s instead of 7.5 s.
- A test file that the configuration also mutates. After any change to it, the mutants that its tests cover run again,
  as [What the runner does](#what-the-runner-does) describes.

In CI, cache the incremental file. Key the cache on the Stryker configuration, the lockfile and the Node.js version, so
that a change to those runs in full. Pass `--force` on the default branch, so that each push there stores fresh
results.

## Make your tests safe for parallel runs

Stryker runs several mutant runs at once, one per worker, all in one copy of your project, its sandbox. Tests that
pass under `node --test` can then fail each other. Stryker counts such a failure as a kill, though no test detected the
mutant. These setups gave wrong statuses in open-source projects:

- **A fixed port.** restartable's tests listen on port 4242. At concurrency 5, a mutant run failed with
  `EADDRINUSE` whenever another worker held the port. This runner and the `command` runner then disagreed on whether
  24 to 27 mutants were detected, each time through `EADDRINUSE`. At concurrency 1 they agreed on every detected
  mutant. Listen on port 0, so that the system picks a free port, and read the port from the server. If you cannot,
  run Stryker with `--concurrency 1`.
- **A file in the package.** pino-pretty's tests write files inside the package, and one test lists a folder that
  others write to. At concurrency 5, 8 mutants were killed only because two workers' tests failed each other. Write
  such files to a folder that each test creates, for example with `fs.mkdtemp()` in `os.tmpdir()`.
- **A path outside the sandbox.** A sonic-boom test expects `new SonicBoom({ dest: '/path/to/nowwhere' })` to throw.
  Mutants that let the code create missing folders made it create `C:\path\to\nowwhere` at the root of the drive.
  From then on, the test failed without a mutant, so up to 27 later kills in that run may have come from that failure
  and not from the mutants. Stryker's sandbox does not stop a test from writing to an absolute path. For a path that
  must not exist, use one inside a temporary folder that the test creates, such as `join(dir, 'missing', 'file')`.

## Close what your tests open

A test file whose tests leave something open, such as a listening server, keeps its process alive after its tests
end. The runner ends such a file once its tests and root `after` hooks have finished: at once if a test failed,
otherwise 30 seconds later. In the dry run, Stryker then reports an error that names the file and what held it open.
In a mutant run, the mutant counts as timed out.

To fix it, close what the tests open in an `after` hook. If you cannot, pass `--test-force-exit` in `nodeArgs`.
`NODE_OPTIONS` does not accept that flag. Under it, `node:test` loses errors that are raised after the tests and root
`after` hooks end.

## Run under the permission model

When the test files run under Node.js's permission model (`--permission`), give them three permissions:

- `--allow-fs-read` for the runner package's `dist` folder, beside the files that the tests read. Each process loads
  the runner's hook from there through `--import`. Without read access, every test file fails as it starts.
  `--allow-fs-read=*` covers it.
- `--allow-fs-write` for the runner's run directories, `lz-node-test-*` in `os.tmpdir()`. Each process
  writes its results there. Without write access, every test file ends with "Missing test results".
- `--allow-worker`. Each process watches its memory from a worker thread. Without it, no memory limit applies, and
  `maxMemoryMB` has no effect.

## Temporary files

The runner keeps its run directories in `os.tmpdir()`, named `lz-node-test-*`, and removes them when the run
ends. Each test file's process gets its own empty folder there as `TMPDIR`, `TEMP` and `TMP`, so `os.tmpdir()` in a
test returns that folder, which is removed when the file ends. Which test files the dry run ran, and what it measured of each, its memory peak and its start-up, is kept in
`lz-node-test-dry-run-<pid>-store` and stays until Stryker's own process exits, as the mutant runs read it.
When Stryker is killed instead, the next run removes it, as it removes any directory that a crashed run left behind.
With `maxMemoryMB` set, the runner records no peaks.
