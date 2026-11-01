import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { lzDryRunStore, lzOwnDryRun } from '../../src/dry-run-store.ts';
import { envNames } from '../../src/record.ts';

function setup(t: TestContext) {
  const parent = mkdtempSync(join(tmpdir(), 'dry-run-store-'));
  t.after(() => {
    rmSync(parent, { recursive: true, force: true });
  });
  const store = lzDryRunStore(join(parent, 'dry-run'));
  store.start();

  return { store };
}

describe('lzDryRunStore', () => {
  it('reads back what it wrote, apart for each file and each kind', (t) => {
    const { store } = setup(t);
    store.write('a.test.ts', 'peak', '370');
    store.write('a.test.ts', 'start-up', '{"startUpMs":401,"tests":5}');
    store.write('b.test.ts', 'peak', '120');

    assert.deepEqual(
      [store.read('a.test.ts', 'peak'), store.read('a.test.ts', 'start-up'), store.read('b.test.ts', 'peak')],
      ['370', '{"startUpMs":401,"tests":5}', '120'],
    );
  });

  it('reads nothing of a file and kind that it did not write', (t) => {
    const { store } = setup(t);
    store.write('a.test.ts', 'peak', '370');

    assert.deepEqual([store.read('a.test.ts', 'start-up'), store.read('b.test.ts', 'peak')], [undefined, undefined]);
  });
});

describe('lzOwnDryRun', () => {
  it('returns the owner a parent process passed on, and keeps it', (t) => {
    const before = process.env[envNames.dryRunOwner];
    t.after(() => {
      if (before === undefined) {
        Reflect.deleteProperty(process.env, envNames.dryRunOwner);
      } else {
        process.env[envNames.dryRunOwner] = before;
      }
    });
    process.env[envNames.dryRunOwner] = '4242';

    assert.equal(lzOwnDryRun(), 4242);
    assert.equal(process.env[envNames.dryRunOwner], '4242');
  });
});
