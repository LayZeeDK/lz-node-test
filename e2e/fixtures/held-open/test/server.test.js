import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from 'node:test';

import { greeting } from '../src/greeting.js';

// The server is never closed, so the file's process stays alive after its tests.
it('greets while a server listens', async () => {
  const server = createServer();

  await new Promise((resolve) => server.listen(0, resolve));
  assert.equal(greeting('e2e'), 'Hello, e2e!');
});
