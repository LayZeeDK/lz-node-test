import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { lzTestFor } from '@layzee/lz-node-test';
import { lzDryRunStore, lzOwnDryRun } from '../../src/dry-run-store.ts';
import { envNames } from '../../src/record.ts';

function setup(t: TestContext) {
  const parent = mkdtempSync(join(tmpdir(), 'dry-run-store-'));
  t.after(() => {
    rmSync(parent, { recursive: true, force: true });
  });
  const dir = join(parent, 'dry-run');
  const store = lzDryRunStore(dir);
  store.start();

  return { dir, store };
}

describe('lzDryRunStore', () => {
  it('starts empty, whatever an earlier run left in its directory', (t) => {
    const { dir, store } = setup(t);
    store.write('a.test.ts', 'peak', '370');
    store.write('a.test.ts', 'start-up', '{"startUpMs":401,"tests":5}');
    mkdirSync(join(dir, 'left'));
    writeFileSync(join(dir, 'left', 'other'), 'x');

    lzDryRunStore(dir).start();

    assert.deepEqual(
      [readdirSync(dir), store.read('a.test.ts', 'peak'), store.read('a.test.ts', 'start-up')],
      [[], undefined, undefined],
    );
  });

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
  function inherit(t: TestContext, owner: string): void {
    const before = process.env[envNames.dryRunOwner];
    t.after(() => {
      if (before === undefined) {
        Reflect.deleteProperty(process.env, envNames.dryRunOwner);
      } else {
        process.env[envNames.dryRunOwner] = before;
      }
    });
    process.env[envNames.dryRunOwner] = owner;
  }

  it('returns the owner a parent process passed on, and keeps it', (t) => {
    inherit(t, '4242');

    assert.equal(lzOwnDryRun(), 4242);
    assert.equal(process.env[envNames.dryRunOwner], '4242');
  });

  lzTestFor<readonly [string]>([[''], ['not a pid'], ['0'], ['-4242'], ['42.5'], ['1e999']])(
    'owns the dry run itself when the owner passed on reads %j',
    ([owner], t) => {
      inherit(t, owner);

      assert.equal(lzOwnDryRun(), process.pid);
      assert.equal(process.env[envNames.dryRunOwner], String(process.pid));
    },
  );
});
