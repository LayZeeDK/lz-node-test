---
status: accepted
---

# Run each test file in its own node process in every run

The runner starts every test file in a fresh `node` process, in the dry run and in each mutant run, so that a mutant
cannot leak state from one test file into another. Process start then dominates what a mutant run costs, which the
runner's deadline and its crediting of work outside tests account for.

## Considered options

- One process per mutant run that loads every test file with node:test's `isolation: 'none'`, the design of the open
  stryker-js PR #6020, or Node.js's `--test-isolation=none` for this runner. In purpose-built test files on Node.js
  22.23.1 and 24.18.1, files then shared module state, globals and top-level code, so a test in one file killed a
  mutant only because another file ran first. Load errors were lost or blamed on the wrong test, and hit counts added
  up across files. A real suite without such sharing keeps its verdicts: fast-json-stringify's tests under Stryker's
  command runner changed no status in one process (43b7bf3), but this runner cannot tell which suites share.

## Consequences

- A test file's own work outside its tests, such as module load, top-level hooks and exit listeners, runs again in
  every mutant run, and each test's time includes its file's start-up.
- Memory limits, process records and the ending of leftover processes all work per test file.
- The OSS evaluation's command side may still run a project's tests in one process to make its runs faster. That
  setting belongs to the comparison, not to this runner.

Evidence: 01b930d, 640d51b, 104b27d, 43b7bf3, the "What the runner does" and "What a run costs" sections of the README,
stryker-js PR #6020.
