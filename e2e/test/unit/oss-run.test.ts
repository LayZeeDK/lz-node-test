import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { lzClearSideFiles } from '../../src/oss/run.ts';

function setup(t: TestContext, names: readonly string[]): string {
  const out = mkdtempSync(join(tmpdir(), 'lz-oss-run-'));

  t.after(() => {
    rmSync(out, { recursive: true, force: true });
  });
  names.forEach((name) => {
    writeFileSync(join(out, name), '');
  });

  return out;
}

describe('lzClearSideFiles', () => {
  it("removes an earlier run's report and log of the side, and keeps the other side's", (t) => {
    const out = setup(t, ['lz.mutation.json', 'lz.log', 'command.mutation.json', 'command.log', 'result.json']);

    lzClearSideFiles(out, 'lz');

    assert.deepEqual(readdirSync(out).sort(), ['command.log', 'command.mutation.json', 'result.json']);
  });

  it('accepts a folder that holds neither file', (t) => {
    const out = setup(t, []);

    lzClearSideFiles(out, 'command');

    assert.deepEqual(readdirSync(out), []);
  });
});
