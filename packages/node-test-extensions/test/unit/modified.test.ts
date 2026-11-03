import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { templateRows } from '../../src/modified.ts';
import { lzTestEach } from '../../src/test-each.ts';

describe('templateRows', () => {
  lzTestEach([
    [
      ['\n  a | b\n  ', ' | ', '\n  ', ' | ', '\n'],
      [1, 2, 3, 4],
      [
        { a: 1, b: 2 },
        { a: 3, b: 4 },
      ],
    ],
    [['first name|x\n', '|', ''], [1, 2, 3], [{ firstname: 1, x: 2 }]],
    [['a|b', '|', ''], [1], []],
    [['a\tb ', ''], [1], [{ 'a\tb': 1 }]],
  ])('reads %o with %o', (strings, values, rows) => {
    assert.deepEqual(templateRows(strings, values), rows);
  });
});
