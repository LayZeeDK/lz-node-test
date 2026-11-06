import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { lzApplyPatches, lzFileWriters } from '../../src/oss/prepare.ts';

/** A project folder with an empty test folder, removed after the test. */
function project(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'lz-oss-prepare-'));

  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  mkdirSync(join(dir, 'test'));

  return dir;
}

describe('lzApplyPatches', () => {
  it('replaces the text once, taking the replacement literally', (t) => {
    const dir = project(t);

    writeFileSync(join(dir, 'test', 'once.js'), "const a = 'x'\n");
    lzApplyPatches(dir, [{ file: 'test/once.js', from: "'x'", to: "'$&y'" }]);

    assert.equal(readFileSync(join(dir, 'test', 'once.js'), 'utf8'), "const a = '$&y'\n");
  });

  it('refuses a patch whose text is missing or repeated, naming the file and the count', (t) => {
    const dir = project(t);

    writeFileSync(join(dir, 'test', 'twice.js'), 'x x');

    assert.throws(
      () => {
        lzApplyPatches(dir, [{ file: 'test/twice.js', from: 'x', to: 'y' }]);
      },
      { message: 'The patch of test/twice.js expects "x" once and found it 2 times.' },
    );
    assert.throws(
      () => {
        lzApplyPatches(dir, [{ file: 'test/twice.js', from: 'z', to: 'y' }]);
      },
      { message: 'The patch of test/twice.js expects "z" once and found it 0 times.' },
    );
  });
});

describe('lzFileWriters', () => {
  it('lists the matched test files that call fs writes, with their calls, and skips the others', (t) => {
    const dir = project(t);

    writeFileSync(
      join(dir, 'test', 'writes.test.js'),
      'await fs.promises.writeFile(p, c)\nfs.rmSync (p)\nawait fs.promises.writeFile(q, c)\n',
    );
    writeFileSync(join(dir, 'test', 'reads.test.js'), 'fs.readFileSync(p)\n');
    writeFileSync(join(dir, 'writes.js'), 'fs.writeFileSync(p, c)\n');

    assert.deepEqual(
      lzFileWriters(dir, ['test/*.test.js'], []),
      new Map([['test/writes.test.js', ['rmSync', 'writeFile']]]),
    );
  });

  it('lists the files in sorted order, whatever order the patterns match them in', (t) => {
    const dir = project(t);

    writeFileSync(join(dir, 'test', 'a.test.js'), 'fs.rmSync(p)\n');
    writeFileSync(join(dir, 'test', 'b.test.js'), 'fs.rmSync(p)\n');

    assert.deepEqual(
      [...lzFileWriters(dir, ['test/b.test.js', 'test/a.test.js'], []).keys()],
      ['test/a.test.js', 'test/b.test.js'],
    );
  });

  it('leaves out the files the driver patched, whose writes are already dealt with', (t) => {
    const dir = project(t);

    writeFileSync(join(dir, 'test', 'patched.test.js'), 'fs.writeFileSync(p, c)\n');
    writeFileSync(join(dir, 'test', 'other.test.js'), 'fs.writeFileSync(p, c)\n');

    assert.deepEqual(
      lzFileWriters(dir, ['test/*.test.js'], ['test/patched.test.js']),
      new Map([['test/other.test.js', ['writeFileSync']]]),
    );
  });
});
