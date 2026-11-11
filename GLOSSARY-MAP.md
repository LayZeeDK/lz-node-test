# Glossary Map

## Contexts

- [Stryker node:test runner](./packages/stryker-node-test-runner/GLOSSARY.md): runs node:test test files for
  StrykerJS, one fresh process per test file, and reports which tests reach which mutants
- [Mutators](./packages/stryker-mutator-core/GLOSSARY.md): the install layer and the three mutator packages that add
  mutators to StrykerJS
- [Table tests](./packages/node-test-extensions/GLOSSARY.md): `lzTestEach` and `lzTestFor`, Vitest-style table tests
  for node:test
- [OSS evaluation](./e2e/GLOSSARY.md): compares this runner with Stryker's command runner on pinned open-source
  projects, and runs the packed packages in fixture projects
- [Workspace](./docs/GLOSSARY.md): how the workspace loads its own source and gates every project on a mutation score
  of 100

## Relationships

- **Runner and Mutators**: neither imports the other. Both extend StrykerJS in the same run: the runner as a test
  runner plugin, the mutators as installed mutators in Stryker's list.
- **Mutators -> Mutators**: each mutator package depends on `stryker-mutator-core` for the install; the own mark
  tells replace mode which installed mutators belong to other mutator packages. `stryker-node-test-mutators` uses the
  bindings of `stryker-node-mutators`.
- **Workspace -> Runner and Mutators**: the production configuration and the test-code configuration choose the
  runner and install the mutator packages, loaded through the source condition.
- **OSS evaluation -> Runner and Mutators**: installs them as packed packages; both sides install the default Node.js
  mutators, so both mutate the same code into the same mutants.
- **OSS evaluation and Workspace -> StrykerJS reports**: the comparison, the checkpoint, the RuntimeError check and the
  baseline all read Stryker's JSON report; the mutant key follows how Stryker's incremental mode identifies a mutant.
- **Every context -> Table tests**: the packages' own tests use `lzTestEach` and `lzTestFor`; nothing ships with a
  dependency on them.

## Terms that differ between contexts

- **Started process** (runner) is a process or thread that a test file starts; **descendant** (OSS evaluation) is any
  process in the driver's process tree.
- **Part** (OSS evaluation) is a range of one file's mutants run as its own driver run; **shard** (Workspace) is one
  CI job's slice of a project's mutated files.
- **Source clone** (OSS evaluation) is a project checkout; **source condition** (Workspace) is the export condition.
- `lzNodeTest` names the runner's Stryker options; in the mutators' bindings it names node:test's module names.
