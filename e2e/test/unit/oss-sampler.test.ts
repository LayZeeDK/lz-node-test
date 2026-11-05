import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzSnapshot } from '../../src/oss/sampler.ts';

describe('lzSnapshot', () => {
  it("lists this process under its parent, read by this platform's own script", async () => {
    const sample = await lzSnapshot();

    assert.deepEqual(
      sample.filter(({ pid }) => pid === process.pid).map(({ pid, ppid }) => ({ pid, ppid })),
      [{ pid: process.pid, ppid: process.ppid }],
    );
  });
});
