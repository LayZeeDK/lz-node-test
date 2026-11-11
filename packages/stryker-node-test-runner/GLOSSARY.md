# Stryker node:test runner

The StrykerJS test runner plugin that runs node:test test files, each in a fresh `node` process, and tells Stryker
which tests reach which mutants.

## Language

### Runs and processes

**File run**:
One run of one test file in its own fresh `node` process, together with the processes and threads that its code
starts.
_Avoid_: process run, test run

**Main process**:
The test file's own process, which runs node:test and reports the file's tests.
_Avoid_: root process, parent process

**Started process**:
A child process or worker thread that a file run's code starts and that loads the hook.
_Avoid_: descendant, spawned process, child

**Hook**:
The runner's module that every process of a file run loads before its own code.
_Avoid_: preload, loader

**Process record**:
What one process or thread of a file run writes down about the tests it ran, the mutants it reached and its lifetime.
_Avoid_: results file, record file

**Worker copy**:
The experimental private copy of Stryker's sandbox that one test runner makes and runs its test files in.
_Avoid_: sandbox copy

### Tests and coverage

**Test id**:
The runner's name for a test: its file, its chain of suites and its title, with a counter for duplicates.
_Avoid_: test name, title

**Current test**:
The one test of a file that is running at a given moment; the runner runs one test at a time so that each hit has
one owner.
_Avoid_: active test

**Test span**:
The time during which one test was the current test.
_Avoid_: test window

**Lifetime**:
The time during which a started process ran.
_Avoid_: duration

**Hits outside tests**:
Mutant hits made while none of a file's tests ran: loading the file and its imports, top-level hooks, exit listeners,
or a started process between tests.
_Avoid_: static hits, outside

**Static mutant**:
Stryker's term for a mutant that code outside every test reaches; with this runner, code in a file that registers no
tests, or in a started process that lived while no test ran or whose lifetime is unknown.
_Avoid_: global mutant

**Static activation**:
Stryker's way of running a mutant active from the start of each process; the runner uses it for every mutant with hits
outside tests, also when Stryker asks for runtime activation.
_Avoid_: load-time activation

### Time and limits

**Start-up**:
A test file's time outside its tests in the dry run, from starting `node` until the runner has read the file run's
process records, teardown included.
_Avoid_: startup, boot time, overhead

**Deadline**:
The runner's own end time for a mutant run: Stryker's timeout with each test file's start-up counted once.
_Avoid_: timeout, budget

**Timeout reason**:
Why the runner reported a mutant as `Timeout`: the deadline, the hit limit, the memory limit, a held-open file run or a
stalled file run.

**Held open**:
A file run whose process stays alive after its tests and root `after` hooks have finished.
_Avoid_: hang, leak

**Stalled file run**:
A file run in which a test is still pending Stryker's `timeoutMS` after the event loop emptied, with no test result
since.
_Avoid_: hanging test

**Unfinished file run**:
A file run whose process exited before node:test reported every test, as when a test calls `process.exit()`.
_Avoid_: incomplete run

**Memory limit**:
The memory one process of a mutant run may hold before the runner ends it.
_Avoid_: OOM limit

**Memory peak**:
The most memory that any process of a test file held in the dry run.

**Dry-run store**:
What the dry run keeps per test file for every worker's mutant runs: its memory peak, its start-up and the mutants it
reached outside tests.
_Avoid_: cache
