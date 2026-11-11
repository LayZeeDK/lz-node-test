---
status: accepted
---

# Select mutator tiers through the install function's options, with no deprecation period for tier moves

A mutator package sorts its mutators into up to three tiers: default, opt-in and experimental. A configuration selects
them through the options of the package's install function: a mutator's name set to `true`, `extended: true` for every
opt-in mutator, and `experimental: true` or `experimental: { Name: true }` for experimental ones. A mutator that moves
between tiers keeps its name, and from the release that moves it, its old option throws with a message that names the
new tier.

## Considered options

- A subpath entry point per tier, such as `/opt-in` and `/experimental`: decided against before any was built, in
  favour of options on the install function.
- `false` to turn a mutator off: it would duplicate Stryker's `mutator.excludedMutations`.
- A deprecation period for tier moves: none. Moving a mutator breaks a configuration that names it in its old place.

## Consequences

- Importing a mutator package installs nothing. A configuration calls and awaits the install function.
- A configuration in JavaScript has no type check, so the install throws on values other than `true`, on unknown names
  and on names in the wrong tier.
- `extended: true` on a package with no opt-in mutators selects nothing.

Evidence: bc5495c, 50a9829, e4ce3b9 (a mutator moving from experimental to opt-in), the "Opt-in and experimental
mutators" section of `packages/stryker-node-mutators/README.md`.
