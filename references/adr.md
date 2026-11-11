# Keeping the ADRs current

An architecture decision record (ADR) records that a decision was made and why, so that nobody undoes it without
knowing what it cost.

## Where

- `docs/adr/` holds decisions that span the workspace: module format, how packages load each other, the mutation gate,
  CI.
- `<project>/docs/adr/`, such as `packages/stryker-node-test-runner/docs/adr/`, holds decisions inside one context of
  [GLOSSARY-MAP.md](../GLOSSARY-MAP.md).

Each folder numbers its own ADRs: `0001-slug.md`, `0002-slug.md`. Take the highest number in the folder and add one.
Create the folder when its first ADR is written.

## When

Write an ADR only when all three hold:

1. **Hard to reverse**: changing course later costs real work or breaks users.
2. **Surprising without context**: a reader of the code would ask why it is done this way.
3. **A real trade-off**: there were genuine alternatives, and this one was chosen for reasons.

Typical cases here: how the runner runs and times test files, how it credits coverage, how mutators reach Stryker,
what a package publishes, what the workspace gates on. A decision that fails one test goes in the commit message
instead.

Update an existing ADR in the same commit when a change:

- reverses or replaces it: write the new ADR, set the old one's status to `superseded by ADR-NNNN`, and leave the old
  text as it was;
- narrows or widens it without reversing it: add a dated line under `## Consequences`;
- removes what it decides: set its status to `deprecated` and say why in one line.

Read the ADRs of the context you work in before you change what one decides. A change that goes against an accepted
ADR needs the maintainer's agreement first.

## How

```md
---
status: accepted
---

# {Short title that states the decision}

{One to three sentences: the context, what was decided, and why.}

## Considered options

- {Option}: {why it lost, with the measurement or fact that decided it}

## Consequences

- {A downstream effect a reader would not guess}

Evidence: {commit hashes, README sections, upstream issues or source at a tag}
```

- **Lead with the decision.** The title states it ("Run each test file in its own process"), not the topic.
- **Keep `Considered options` and `Consequences` only when they add something.** An ADR can be one paragraph.
- **Cite evidence a reader can open**: commit hashes, README sections, upstream issues or source at a tag. The
  planning records in `.scratch/` are not in the repository, so never cite them.
- **State measurements with their numbers and conditions**, as the commit that made them states them.
- **Use the glossary's terms.**

Run `npx prettier --check` on every file you changed before you commit.
