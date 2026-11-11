---
status: accepted
---

# End a mutant run at a deadline that counts each test file's start-up once

Stryker sizes a mutant's timeout from the times of the tests it runs, and each test's time holds its file's whole
start-up, so a mutant that runs k tests of one file gets that start-up k times in its timeout, although the run starts
the file once. On fastify-cookie, a hanging mutant took 30.2 s to reach `Timeout`, against 5.7 s under Stryker's
command runner. The runner therefore ends a mutant run at its own deadline, Stryker's timeout less `timeoutFactor` times
each file's start-up for each of its tests after the first, and leaves the test times whole, so that Stryker's own
timer stays as the backstop.

## Considered options

- Give each test an equal share of its file's start-up: tried in d6f39e4 and reverted in f82cb78, because a mutant
  that runs few of a file's tests then gets less than one start-up, and a slow-starting file can turn a survivor into a
  false `Timeout`.
- Book start-up in Stryker's `timeOverheadMS` from a serial dry run: overcounts on projects with many test files.
- Report one test per file: loses per-test coverage.
- A per-file overhead in Stryker core: core has none to set.
- Raise `timeoutMS` or lower `timeoutFactor`: moves every mutant's timeout to fix the files with many tests.

## Consequences

- A mutant run has two timers. The deadline ends it as a `Timeout` whose reason names the deadline, and the worker
  keeps running. Stryker's timer ends it as a `Timeout` without a reason and restarts the worker.
- The dry run measures each file's start-up and keeps it in the dry-run store. A file without one, such as a file that
  `--testFiles` left out of the dry run, keeps Stryker's timeout.

Evidence: d6f39e4, f82cb78, 99c0fa8, 97c1e94, the "What the runner does" section of the README, and the timeout
calculation in `packages/core/src/mutants/mutant-test-planner.ts` of stryker-js v10.1.1.
