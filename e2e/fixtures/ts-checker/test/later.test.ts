import assert from 'node:assert/strict';
import { it } from 'node:test';

import { later } from '../src/later.ts';

// setImmediate is not mocked, so this lets every settled promise run its callbacks.
const flush = () => new Promise((resolve) => setImmediate(resolve));

it('resolves after 10 ms, not before', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false;
  const pending = later('x').then((value) => {
    settled = true;

    return value;
  });

  t.mock.timers.tick(9);
  await flush();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(settled, true);
  assert.equal(await pending, 'x');
});
