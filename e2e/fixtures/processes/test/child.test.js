import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { it } from 'node:test';

// child-main.js is the only code that calls childValue(), so its mutants have coverage only when the runner's hook
// loads in the child through the NODE_OPTIONS it inherits.
it('a spawned child computes the value', () => {
  const child = spawnSync(process.execPath, [join(import.meta.dirname, 'child-main.js')], {
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.equal(child.stdout.trim(), 'from-child', child.stderr);
});
