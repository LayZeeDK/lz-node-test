import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { lzDirPrefix } from '../../src/dirs.ts';
import type { ProcessRecord } from '../../src/record.ts';
import { lzCopySandbox, lzRebase, lzRebaseRecord } from '../../src/worker-copy.ts';

describe('lzRebase', () => {
  it("gives a test id under the sandbox the copy's path instead", () => {
    const sandbox = join('work', 'sandbox');
    const copy = join('work', 'copy');

    assert.equal(
      lzRebase(`${join(sandbox, 'test', 'a.test.js')} > adds`, sandbox, copy),
      `${join(copy, 'test', 'a.test.js')} > adds`,
    );
  });

  it("leaves a path in a folder whose name starts with the sandbox's", () => {
    const sandbox = join('work', 'sandbox');
    const sibling = join('work', 'sandbox-2', 'a.test.js');

    assert.equal(lzRebase(sibling, sandbox, join('work', 'copy')), sibling);
  });
});

function sandboxDir(t: TestContext, files: Readonly<Record<string, string>>): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'worker-copy-')));
  const sandbox = join(root, 'sandbox');

  Object.entries(files).forEach(([name, content]) => {
    mkdirSync(dirname(join(sandbox, name)), { recursive: true });
    writeFileSync(join(sandbox, name), content);
  });
  t.after(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  return sandbox;
}

describe('lzCopySandbox', () => {
  it("copies the sandbox's files into a folder of this process beside it", (t) => {
    const sandbox = sandboxDir(t, { [join('test', 'a.test.js')]: 'content' });

    const copy = lzCopySandbox(sandbox, 123);

    assert.equal(dirname(copy), dirname(sandbox));
    assert.ok(basename(copy).startsWith(lzDirPrefix('copy', 123)), copy);
    assert.equal(readFileSync(join(copy, 'test', 'a.test.js'), 'utf8'), 'content');
  });

  it("links to what the sandbox's directory links point at, as Stryker links node_modules, without copying it", (t) => {
    const sandbox = sandboxDir(t, { 'index.js': '' });
    const modules = join(dirname(sandbox), 'node_modules');
    mkdirSync(join(modules, 'dep'), { recursive: true });
    symlinkSync(modules, join(sandbox, 'node_modules'), 'junction');

    const copy = lzCopySandbox(sandbox, 123);

    assert.ok(lstatSync(join(copy, 'node_modules')).isSymbolicLink());
    assert.equal(realpathSync.native(join(copy, 'node_modules')), modules);
  });
});

describe('lzRebaseRecord', () => {
  it("names a record's tests, their coverage and their spans by the sandbox's path", () => {
    const copy = join('work', 'copy');
    const sandbox = join('work', 'sandbox');
    const span = [{ start: 1, end: 2 }];
    const record: ProcessRecord = {
      main: true,
      tests: [{ id: `${join(copy, 'a.test.js')} > adds`, status: 'passed', timeSpentMs: 3 }],
      hitCount: 4,
      mutantCoverage: { static: { '1': 1 }, perTest: { [`${join(copy, 'a.test.js')} > adds`]: { '2': 1 } } },
      testSpans: { [`${join(copy, 'a.test.js')} > adds`]: span },
    };

    assert.deepEqual(lzRebaseRecord(record, copy, sandbox), {
      main: true,
      tests: [{ id: `${join(sandbox, 'a.test.js')} > adds`, status: 'passed', timeSpentMs: 3 }],
      hitCount: 4,
      mutantCoverage: { static: { '1': 1 }, perTest: { [`${join(sandbox, 'a.test.js')} > adds`]: { '2': 1 } } },
      testSpans: { [`${join(sandbox, 'a.test.js')} > adds`]: span },
    });
  });
});
