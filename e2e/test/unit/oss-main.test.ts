import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

const main = join(import.meta.dirname, '..', '..', 'src', 'oss', 'main.ts');

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'lz-oss-main-'));

  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  return {
    dir,
    runMain: (args: readonly string[]) =>
      spawnSync(process.execPath, [main, ...args], {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, TEMP: dir, TMP: dir, TMPDIR: dir },
      }),
  };
}

describe('main', () => {
  it('merges the runs given with --merge and names the result.json it wrote', (t) => {
    const { dir, runMain } = setup(t);
    const runDir = join(dir, 'run');

    mkdirSync(runDir);
    writeFileSync(
      join(runDir, 'lz.mutation.json'),
      JSON.stringify({
        files: {
          'index.js': {
            mutants: [
              {
                mutatorName: 'StringLiteral',
                replacement: '""',
                status: 'Killed',
                location: { start: { line: 1, column: 3 }, end: { line: 1, column: 9 } },
              },
            ],
          },
        },
      }),
    );
    writeFileSync(
      join(runDir, 'result.json'),
      JSON.stringify({
        project: 'p',
        sourceCommit: 'f00d',
        node: 'v24.18.1',
        platform: 'win32-arm64',
        mutantTimeoutMs: 30000,
        installedVersions: [],
        tarballDigests: [],
        projectSetup: { mutate: ['index.js'], testFiles: ['test/*.test.js'], patches: [] },
        sides: { lz: { stryker: { reported: true }, strykerConfig: 'lz config' } },
      }),
    );

    const out = join(dir, 'merged');
    const { status, stdout, stderr } = runMain(['--merge', join(runDir, 'result.json'), '--out', out]);

    assert.deepEqual(
      { status, stdout, stderr },
      { status: 0, stdout: `Wrote ${join(out, 'result.json')}\n`, stderr: '' },
    );
  });

  it('runs the driver otherwise, which stops at a --source that does not exist', (t) => {
    const { dir, runMain } = setup(t);
    const source = join(dir, 'missing');
    const { status, stderr } = runMain([
      '--project',
      'env-schema',
      '--source',
      source,
      '--out',
      join(dir, 'out'),
      '--concurrency',
      '1',
      '--npm-before',
      '2026-11-04',
    ]);

    assert.equal(status, 1);
    assert.ok(stderr.includes(`ENOENT: no such file or directory, lstat '${source}'`), stderr);
  });
});
