# Agent guide

## Proving tests

- Prove that a test catches a change with `npx nx run <project>:mutate-src --mutate <file>:<start>-<end>` (for
  example
  `npx nx run @layzee/stryker-node-test-runner:mutate-src --mutate packages/stryker-node-test-runner/src/dirs.ts:80-80`;
  a line without a range matches no file, and the dry run still reports success), not by reverting code or writing a
  control test by hand

## Domain language

[GLOSSARY-MAP.md](GLOSSARY-MAP.md) lists the workspace's contexts and the `GLOSSARY.md` of each. Name things in code,
tests, docs and commit messages with the term the context's glossary gives.

Update the glossary in the same commit when a change adds, renames, splits or retires a domain concept, or moves one
between contexts. How: [references/glossary.md](references/glossary.md).

## Decisions

Architecture decision records (ADRs) live in [docs/adr](docs/adr) for decisions that span the workspace and in
`<project>/docs/adr` for one context. Read the ADRs of the context before changing what one decides.

Write or update an ADR in the same commit when a change makes a decision that is hard to reverse, surprising without
context and the result of a real trade-off, or reverses an existing ADR. How: [references/adr.md](references/adr.md).
