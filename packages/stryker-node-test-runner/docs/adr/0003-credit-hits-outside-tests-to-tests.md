---
status: accepted
---

# Credit a test file's hits outside its tests to its tests, and activate those mutants statically

A test file's own process does work outside its tests: it loads the file and its imports, and runs top-level hooks and
exit listeners. Because every mutant run starts each file fresh, that work runs again for whichever of the file's tests
a mutant runs, so the runner counts such hits toward each test of the file instead of as Stryker's static coverage, as
Stryker's tap runner does for a test file's load. A mutant reached that way runs with static activation, active from
the start of each process, even when Stryker asks for runtime activation. A mutant that only tests reach keeps runtime
activation.

## Considered options

- Keep such hits as static coverage: Stryker then runs every test file for the mutant, one after another, and with
  `ignoreStatic` reports it as `Ignored` without running it.
- Activate every mutant statically: tests would see mutated module-level code for mutants they reach, where the
  mocha, jasmine and vitest runners report such a mutant as survived (05f52f8).

## Consequences

- The first test of the file gets the full hit count and each other test one hit, so Stryker's hit limit does not
  grow with the number of tests in the file.
- A mutant that the file's load and a test both reach now runs with static activation, so that test sees the mutated
  module-level code.
- Static mutants remain for code in a test file that registers no tests, and for a started process that lived while no
  test ran or whose lifetime the runner could not record.
- A test that reaches a mutant only in a process it starts with an environment of its own reports no coverage. While
  the mutant was static, every test ran and that test killed it; now only the tests of the files that load the code
  run, and the mutant survives unless one of them kills it. The README tells users how to keep such a test counted.

Evidence: 05f52f8, c8be1ad, e3cedf7, 104b27d, 810efde, the "What the runner does" section of the README, and
`packages/core/src/mutants/mutant-test-planner.ts` of stryker-js v10.1.1 (static and `ignoreStatic` planning, and the
activation chosen from the test filter).
