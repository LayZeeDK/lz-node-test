// Checked by `npm run typecheck` and never run, as no test file imports it:
// the callbacks get the types of the cases, as in Vitest.
import type { TestContext } from 'node:test';

import { lzTestEach } from '../src/test-each.ts';

type IsAny<T> = 0 extends 1 & T ? true : false;

const tupleRows: readonly [readonly [1, 'a'], readonly [2, 'b']] = [
  [1, 'a'],
  [2, 'b'],
];

lzTestEach(tupleRows)('tuple', (n, s) => {
  n satisfies 1 | 2;
  s satisfies 'a' | 'b';
});
lzTestEach([
  [1, 'a'],
  [2, 'b'],
])('array', (n, s) => {
  n satisfies number;
  // @ts-expect-error The second value is a string.
  s satisfies number;
});
lzTestEach([{ a: 1 }, { a: 2 }])('object', (row) => {
  row.a satisfies number;
  // @ts-expect-error The rows have no b.
  void row.b;
});
lzTestEach([1, 2])('scalar', (n) => {
  n satisfies number;
});
// @ts-expect-error Every argument is a value of the case.
lzTestEach([1, 2])('extra', (_n, _extra: string) => {});
lzTestEach`a | b ${1} | ${2}`('template', (_row) => {
  true satisfies IsAny<typeof _row>;
});
lzTestEach([1])('timeout', () => {}, 100);
lzTestEach([1])('options', { timeout: 100, fails: true, skip: 'reason' }, () => {});
lzTestEach([1])('todo');
// @ts-expect-error The options go before the function.
lzTestEach([1])('options last', () => {}, { timeout: 100 });
// @ts-expect-error A test of lzTestEach gets no context.
lzTestEach([1])('context', (_n: number, _t: TestContext) => {});
