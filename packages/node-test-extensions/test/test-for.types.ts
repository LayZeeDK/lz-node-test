// Checked by `npm run typecheck` and never run, as no test file imports it:
// the callbacks get the types of the cases, as in Vitest.
import type { TestContext } from 'node:test';

import { lzTestFor } from '../src/test-for.ts';

type Equal<TActual, TExpected> = 0 extends 1 & TActual
  ? false
  : [TActual, TExpected] extends [TExpected, TActual]
    ? true
    : false;

const tupleRows: readonly [readonly [1, 'a'], readonly [2, 'b']] = [
  [1, 'a'],
  [2, 'b'],
];

lzTestFor(tupleRows)('tuple', ([n, s], t) => {
  n satisfies 1 | 2;
  s satisfies 'a' | 'b';
  t satisfies TestContext;
});
lzTestFor([1, 2])('scalar', (n, t) => {
  n satisfies number;
  t.diagnostic('');
});
lzTestFor`a | b ${1} | ${2}`('template', (row, t) => {
  true satisfies Equal<typeof row, Readonly<Record<string, unknown>>>;
  const { a, b } = row;
  // @ts-expect-error A template table's columns are unknown until the test checks them.
  (a - b) satisfies number;
  t satisfies TestContext;
});
lzTestFor([1])('timeout', () => {}, 100);
lzTestFor([1])('options', { fails: true }, (n) => {
  // @ts-expect-error The case is a number.
  n satisfies string;
});
