---
status: accepted
---

# Ship ES modules only, and have mutators follow ES module imports only

Every package is an ES module package (`"type": "module"`, no `require` export condition) for Node.js 22.18 or later.
A mutator that checks which built-in module a function comes from follows an ES module `import` but not a CommonJS
`require`. Supporting one module system keeps the packages and each mutator's import check smaller and easier to
maintain.

## Considered options

- Also follow CommonJS `require` in the mutators: declined, so that each import-bound mutator has one way of finding
  its module.

## Consequences

- A CommonJS file gets no mutant from an import-bound mutator, and `LzNodeAwaitStatement` there also removes awaits in
  node:test teardown callbacks.
- `LzNodeTestCatchAssert` matches assertions by name, not by import, so it also mutates files that `require`
  `node:assert`.

Evidence: 205c182 (the ES module base configuration and engines), 0765eb3 (why the floor is 22.18), 20ea351
("ES modules, not CommonJS"), the "ES modules only" section of `packages/stryker-node-mutators/README.md`.
