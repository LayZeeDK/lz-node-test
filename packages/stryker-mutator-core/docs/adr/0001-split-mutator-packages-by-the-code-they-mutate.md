---
status: accepted
---

# Split mutators into packages by the code they mutate, over a shared stryker-mutator-core

StrykerJS has no plugin kind for mutators, so each mutator package installs its mutators into Stryker's list from the
configuration file. The install layer lives in `@layzee/stryker-mutator-core`, which knows nothing about Node.js. The
mutators are split by the code they mutate: `@layzee/stryker-node-mutators` for production code that uses Node.js APIs
and `node:assert`, `@layzee/stryker-node-test-mutators` for node:test test files, and `@layzee/stryker-js-mutators` for
any JavaScript or TypeScript.

## Considered options

- A test-code entry point inside the production package, `@layzee/stryker-node-mutators/test-code`, as before
  825855f: replaced by a package of its own, so that each package holds the mutators for one kind of code.

## Consequences

- A production configuration adds its mutators to Stryker's own, and a test-code configuration replaces Stryker's
  mutators with the test-code ones. Replace mode keeps the mutators that other mutator packages installed through the
  core, identified by the own mark. A mutator installed some other way is dropped from a test-code run.
- `@layzee/stryker-node-test-mutators` uses the bindings of `@layzee/stryker-node-mutators` to recognise `node:assert`
  calls, without installing that package's mutators.
- The core holds the install, the self-check and the peer range warning, so a new mutator package reuses them instead
  of copying them.

Evidence: 72ee708, 80a3865, 825855f, 4de3e51, the package READMEs.
