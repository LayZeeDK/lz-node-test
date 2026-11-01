# lz-node-test

An Nx workspace with three ESM-only packages for Node.js 22.18 or later, tested on Node.js 22 and 24:

- [`@layzee/lz-stryker-node-test-runner`](packages/lz-stryker-node-test-runner/README.md): a StrykerJS test runner
  for `node:test` that runs each test file in its own `node` process.
- [`@layzee/lz-stryker-node-test-mutators`](packages/lz-stryker-node-test-mutators/README.md): StrykerJS mutators for
  code that uses Node.js APIs and `node:assert`, and a set for mutating test files.
- [`@layzee/lz-node-test`](packages/lz-node-test/README.md): `lzTestEach` and `lzTestFor`, table tests for
  `node:test` that work like Vitest's `test.each` and `test.for`.

The MIT license is in `LICENSE`.
