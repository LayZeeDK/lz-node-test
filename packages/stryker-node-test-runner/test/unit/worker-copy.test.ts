import assert from 'node:assert/strict';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import type { ProcessRecord } from '../../src/record.ts';
import { logger } from '../runner.fixtures.ts';
import { lzCopySandbox, lzRebase, lzRebaseRecord, lzRemoveCopy } from '../../src/worker-copy.ts';

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

  it("gives the sandbox's path in a test's name the copy's path too, as each worker's copy differs", () => {
    const sandbox = join('work', 'sandbox');
    const copy = join('work', 'copy');

    assert.equal(
      lzRebase(`${join(sandbox, 'a.test.js')} > writes ${join(sandbox, 'out')}`, sandbox, copy),
      `${join(copy, 'a.test.js')} > writes ${join(copy, 'out')}`,
    );
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
  it('removes its folder again when the copy fails', (t) => {
    const missing = sandboxDir(t, {});

    assert.throws(() => lzCopySandbox(missing, 123), { code: 'ENOENT' });
    assert.deepEqual(readdirSync(dirname(missing)), []);
  });

  it("copies the sandbox's files into a folder of this process beside it", (t) => {
    const sandbox = sandboxDir(t, { [join('test', 'a.test.js')]: 'content' });

    const { dir: copy } = lzCopySandbox(sandbox, 123);

    assert.equal(dirname(copy), dirname(sandbox));
    assert.ok(basename(copy).startsWith('lz-node-test-copy-123-'), copy);
    assert.equal(readFileSync(join(copy, 'test', 'a.test.js'), 'utf8'), 'content');
  });

  it("links to what the sandbox's directory links point at, as Stryker links node_modules, without copying it", (t) => {
    const sandbox = sandboxDir(t, { 'index.js': '' });
    const modules = join(dirname(sandbox), 'node_modules');
    mkdirSync(join(modules, 'dep'), { recursive: true });
    symlinkSync(modules, join(sandbox, 'node_modules'), 'junction');

    const { dir: copy } = lzCopySandbox(sandbox, 123);

    assert.ok(lstatSync(join(copy, 'node_modules')).isSymbolicLink());
    assert.equal(realpathSync.native(join(copy, 'node_modules')), modules);
  });

  it('links to the same place as a link in the sandbox whose target is missing', (t) => {
    const sandbox = sandboxDir(t, { 'index.js': '' });
    const missing = join(dirname(sandbox), 'missing');
    symlinkSync(missing, join(sandbox, 'dangling'), 'junction');

    const { dir: copy } = lzCopySandbox(sandbox, 123);

    assert.equal(readlinkSync(join(copy, 'dangling')), readlinkSync(join(sandbox, 'dangling')));
  });

  it('lists the links it made in the copy, so a caller can remove them before the folder', (t) => {
    const sandbox = sandboxDir(t, { 'index.js': '' });
    const modules = join(dirname(sandbox), 'node_modules');
    mkdirSync(modules);
    symlinkSync(modules, join(sandbox, 'node_modules'), 'junction');

    const { dir, links } = lzCopySandbox(sandbox, 123);

    assert.deepEqual(links, [join(dir, 'node_modules')]);
  });

  it('points a relative link inside the copy, not back into the sandbox', (t) => {
    const sandbox = sandboxDir(t, { [join('sub', 'a.js')]: '' });
    symlinkSync('sub', join(sandbox, 'relative'), 'dir');

    const { dir: copy } = lzCopySandbox(sandbox, 123);

    assert.equal(realpathSync.native(join(copy, 'relative')), join(copy, 'sub'));
  });

  it('links a link whose target is missing as a directory link, so it works once the target folder exists', (t) => {
    const sandbox = sandboxDir(t, { 'index.js': '' });
    const missing = join(dirname(sandbox), 'missing');
    symlinkSync(missing, join(sandbox, 'dangling'), 'junction');

    const { dir: copy } = lzCopySandbox(sandbox, 123);
    mkdirSync(join(missing, 'dep'), { recursive: true });

    assert.deepEqual(readdirSync(join(copy, 'dangling')), ['dep']);
  });
});

function removal(options: { readonly failingLink?: string } = {}) {
  const calls: string[] = [];
  const warnings: string[] = [];
  const log = logger({ debugEnabled: false, warnings });
  const copy = {
    dir: join('work', 'copy'),
    links: [join('work', 'copy', 'node_modules'), join('work', 'copy', 'link')],
  };

  return {
    calls,
    warnings,
    copy,
    run: () =>
      lzRemoveCopy(copy, log, {
        unlink: (link: string) => {
          calls.push(`unlink ${link}`);

          if (link === options.failingLink) {
            throw new Error('EPERM');
          }
        },
        remove: (dir: string) => {
          calls.push(`remove ${dir}`);

          return Promise.resolve();
        },
      }),
  };
}

describe('lzRemoveCopy', () => {
  it('removes each link on its own before the folder, so the removal never follows a link', async () => {
    const { calls, copy, run } = removal();

    await run();

    assert.deepEqual(calls, [...copy.links.map((link) => `unlink ${link}`), `remove ${copy.dir}`]);
  });

  it('leaves the folder for a later runner and warns when a link cannot be removed', async () => {
    const failingLink = join('work', 'copy', 'node_modules');
    const { calls, run, warnings } = removal({ failingLink });

    await run();

    assert.deepEqual(calls, [`unlink ${failingLink}`]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /Left .*copy.* for a later runner to remove: EPERM/);
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
