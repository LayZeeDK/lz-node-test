import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { it } from 'node:test';

// The child gets no NODE_OPTIONS, so the runner's hook never loads in it and nothing records what it reached.
it('a child spawned without NODE_OPTIONS computes the value', () => {
  const { NODE_OPTIONS: _, ...env } = process.env;
  const child = spawnSync(process.execPath, [join(import.meta.dirname, 'unhooked-main.js')], {
    encoding: 'utf8',
    env,
    windowsHide: true,
  });

  assert.equal(child.stdout.trim(), 'from-unhooked', child.stderr);
});
