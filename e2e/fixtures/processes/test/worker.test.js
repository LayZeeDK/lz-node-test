import assert from 'node:assert/strict';
import { once } from 'node:events';
import { it } from 'node:test';
import { Worker } from 'node:worker_threads';

// worker-main.js is the only code that calls workerValue(), so its mutants have coverage only when the runner's hook
// loads in the worker thread.
it('a worker thread computes the value', async () => {
  const worker = new Worker(new URL('./worker-main.js', import.meta.url));
  const [value] = await once(worker, 'message');

  assert.equal(value, 'from-worker');
});
