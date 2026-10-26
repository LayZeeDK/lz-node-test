# @layzee/lz-node-test

Table tests for `node:test`: `lzTestEach` and `lzTestFor` work like Vitest's `test.each` and `test.for`. It is ESM
only and needs Node.js 22.18 or later.

## Install

```sh
npm install --save-dev @layzee/lz-node-test
```

## Write a table test

Each case of the table becomes one `node:test` test. The name formats the case as Vitest does.

```ts
import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach, lzTestFor } from '@layzee/lz-node-test';

describe('add', () => {
  // An array case is spread into the callback's arguments.
  lzTestEach([
    [1, 1, 2],
    [2, 3, 5],
  ])('adds %i and %i to %i', (a, b, sum) => {
    assert.equal(a + b, sum);
  });

  // lzTestFor passes the case whole, and node:test's test context as the second argument.
  lzTestFor([
    { a: 1, b: 1, sum: 2 },
    { a: 2, b: 3, sum: 5 },
  ])('adds $a and $b to $sum', ({ a, b, sum }, t) => {
    t.assert.equal(a + b, sum);
  });
});
```

## Reference

### `lzTestEach(cases)(name, fn?, timeout?)`

Registers one test per case. When every case is an array, a case is spread into `fn`'s arguments; otherwise `fn` gets
the case whole. `fn` gets no test context; use `lzTestFor` for that. Without `fn`, each test is a todo test.

A template literal table names its columns in its first line and gives `fn` one object per row:

```ts
lzTestEach`
  a    | b    | sum
  ${1} | ${1} | ${2}
  ${2} | ${3} | ${5}
`('adds $a and $b to $sum', ({ a, b, sum }) => {
  assert.equal(a + b, sum);
});
```

### `lzTestFor(cases)(name, fn?, timeout?)`

Registers one test per case, as `lzTestEach` does, except that `fn` always gets the case whole and the test context
as its second argument.

### Options

Both functions take the options as the second argument instead of a timeout: `(name, options, fn?)`. The options are
`node:test`'s test options (`timeout`, `skip`, `only`, `todo`, and the others), plus `fails`, which makes a test pass
only when its body fails.

### Modifiers

Chain modifiers before the table, in any order: `lzTestEach.skip`, `.only`, `.todo` and `.fails` turn their flag on.
`.skipIf(condition)` and `.runIf(condition)` set `skip`, as in Vitest, and override a `skip` before them.

```ts
lzTestEach.skipIf(process.platform === 'win32')([['/tmp']])('reads %s', (dir) => {
  // ...
});
```

### Name formats

| Format                                  | Prints                                                 |
| --------------------------------------- | ------------------------------------------------------ |
| `%s` `%d` `%i` `%f` `%j` `%o` `%O` `%c` | the next value of the case, as `util.format` prints it |
| `%#`                                    | the index of the case                                  |
| `%$`                                    | the number of the case, starting at 1                  |
| `%%`                                    | a percent sign                                         |
| `$name`, `$a.b`, `$a[0]`                | a property of an object case, by its path              |
