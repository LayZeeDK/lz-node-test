import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { lzMutantsByLine, lzPartRanges } from '../../src/oss/parts.ts';

const source = [
  "'use strict'",
  '',
  'function a () {',
  '  return 1',
  '}',
  '',
  'function b () {',
  '  return 2',
  '}',
  'const c = 3; const d = 4',
  'module.exports = { a, b, c, d }',
].join('\n');

describe('lzPartRanges', () => {
  it('gives the whole file as one part', () => {
    assert.deepEqual(lzPartRanges('index.js', source, 1), ['index.js:1-11']);
  });

  it('cuts only where a top-level statement starts, nearest an even share of the lines', () => {
    assert.deepEqual(lzPartRanges('index.js', source, 2), ['index.js:1-6', 'index.js:7-11']);
  });

  it('weighs each line as given', () => {
    const mutantsByLine = new Map([
      [4, 1],
      [8, 1],
      [10, 6],
      [11, 4],
    ]);

    assert.deepEqual(
      lzPartRanges('index.js', source, 2, (line) => mutantsByLine.get(line) ?? 0),
      ['index.js:1-10', 'index.js:11-11'],
    );
  });

  it('never cuts inside a statement or between two statements that share a line', () => {
    const ranges = lzPartRanges('index.js', source, 11);

    assert.deepEqual(ranges, ['index.js:1-2', 'index.js:3-6', 'index.js:7-9', 'index.js:10-10', 'index.js:11-11']);
  });

  it('counts lines as Stryker does, where U+2028 also ends a line', () => {
    const ranges = lzPartRanges('index.js', "const a = ' '\nconst b = 1\nconst c = 2", 3);

    assert.deepEqual(ranges, ['index.js:1-2', 'index.js:3-3', 'index.js:4-4']);
  });

  it('refuses a part count below 1', () => {
    assert.throws(() => lzPartRanges('index.js', source, 0), { message: 'parts is a positive integer; got 0.' });
  });
});

function reportWith(t: TestContext, mutantLinesByFile: Readonly<Record<string, readonly number[]>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'lz-oss-parts-'));
  const file = join(dir, 'mutation.json');
  const files = Object.fromEntries(
    Object.entries(mutantLinesByFile).map(([name, lines]) => [
      name,
      {
        mutants: lines.map((line) => ({
          mutatorName: 'BooleanLiteral',
          location: { start: { line, column: 1 }, end: { line, column: 5 } },
          status: 'Killed',
        })),
      },
    ]),
  );

  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(file, JSON.stringify({ files }));

  return file;
}

describe('lzMutantsByLine', () => {
  it('counts the mutants on each line of the file the report names exactly', (t) => {
    const report = reportWith(t, { 'lib/utils/index.js': [9, 9], 'index.js': [1, 2, 2] });

    assert.deepEqual(
      lzMutantsByLine(report, 'index.js'),
      new Map([
        [1, 1],
        [2, 2],
      ]),
    );
  });

  it('refuses a file the report does not have, and names those it has', (t) => {
    const report = reportWith(t, { 'lib/index.js': [1] });

    assert.throws(() => lzMutantsByLine(report, 'index.js'), {
      message: `${report} has no file "index.js"; it has lib/index.js.`,
    });
  });
});

function partsMain(t: TestContext, args: readonly string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'lz-oss-parts-main-'));
  const path = join(dir, 'index.js');

  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(path, source);

  return spawnSync(
    process.execPath,
    [join(import.meta.dirname, '..', '..', 'src', 'oss', 'parts-main.ts'), path, ...args],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );
}

describe('parts-main', () => {
  it('prints a --mutate per part', (t) => {
    const { status, stdout, stderr } = partsMain(t, ['index.js', '2']);

    assert.deepEqual(
      { status, stdout, stderr },
      { status: 0, stdout: '--mutate index.js:1-6\n--mutate index.js:7-11\n', stderr: '' },
    );
  });

  it('says so when the file has fewer parts than asked for', (t) => {
    const { status, stdout, stderr } = partsMain(t, ['index.js', '6']);

    assert.deepEqual(
      { status, stdout, stderr },
      {
        status: 0,
        stdout:
          '--mutate index.js:1-2\n--mutate index.js:3-6\n--mutate index.js:7-9\n--mutate index.js:10-10\n' +
          '--mutate index.js:11-11\n',
        stderr: 'index.js has only 5 parts between its top-level statements.\n',
      },
    );
  });

  it('refuses a call without the part count and prints the usage', (t) => {
    const { status, stdout, stderr } = partsMain(t, ['index.js']);

    assert.deepEqual({ status, stdout }, { status: 1, stdout: '' });
    assert.ok(
      stderr.includes(
        'Usage: node e2e/src/oss/parts-main.ts <path to the file> <file as --mutate names it> <parts> [<mutation.json>]',
      ),
      stderr,
    );
  });
});
