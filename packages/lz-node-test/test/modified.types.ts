// Checked by `npm run typecheck` and never run, as no test file imports it:
// the modifiers keep the callbacks' types, as in Vitest.
import type { TestContext } from 'node:test';

import { lzTestEach } from '../src/test-each.ts';
import { lzTestFor } from '../src/test-for.ts';

lzTestEach.skip.only.todo.fails.skipIf(true).runIf(false)([1])('modifiers', (n) => {
  n satisfies number;
});
lzTestFor.fails.skipIf(1)([1])('modifiers', (n, t) => {
  n satisfies number;
  t satisfies TestContext;
});
// @ts-expect-error The modifiers go before the table.
void lzTestEach([1]).skip;
