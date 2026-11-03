# lz-node-test

An Nx workspace with three ESM-only packages for Node.js 22.18 or later, tested on Node.js 22 and 24:

- [`@layzee/stryker-node-test-runner`](packages/stryker-node-test-runner/README.md): a StrykerJS test runner
  for `node:test` that runs each test file in its own `node` process.
- [`@layzee/stryker-node-test-mutators`](packages/stryker-node-test-mutators/README.md): StrykerJS mutators for
  code that uses Node.js APIs and `node:assert`, and a set for mutating test files.
- [`@layzee/node-test-extensions`](packages/node-test-extensions/README.md): `lzTestEach` and `lzTestFor`, table tests for
  `node:test` that work like Vitest's `test.each` and `test.for`.

The MIT license is in `LICENSE`.
