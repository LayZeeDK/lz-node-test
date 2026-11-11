# Workspace

How this workspace tests itself: its packages load each other as TypeScript source, and every project must reach a
mutation score of 100.

## Language

### Loading

**Source condition**:
The `@layzee/source` export condition, which makes the workspace's packages load each other's TypeScript source
instead of built output.
_Avoid_: dev condition

**Packed packages**:
The workspace's packages as npm would install them, which the OSS evaluation and the fixture e2e tests run instead of
the source.
_Avoid_: dist, build

### Mutation runs

**Production configuration**:
A project's Stryker configuration that mutates its source with Stryker's mutators plus the Node.js mutators, and the
JavaScript mutators where it turns them on.
_Avoid_: src config

**Test-code configuration**:
A project's Stryker configuration that mutates its test files with the node:test mutators alone.
_Avoid_: test config

**Mutation gate**:
The rule that a mutation run fails unless it scored mutants, its mutation score is 100, and every `RuntimeError`
mutant is listed with a reason.
_Avoid_: coverage gate

**RuntimeError check**:
The step after each mutation run that fails on a `RuntimeError` mutant not listed with a reason, because Stryker
leaves such mutants out of the score.

**Shard**:
One CI job's slice of a project's mutated files.
_Avoid_: part

**Baseline**:
The full mutation run of each configuration on every push to `main`, whose results pull requests start from.
_Avoid_: cache
