import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';

import { lzTestFor } from '@layzee/lz-node-test';

const src = (file: string) => JSON.stringify(pathToFileURL(join(import.meta.dirname, '../../src', file)).href);

/**
 * Stands in for Stryker's main process: it imports the plugin entry, as Stryker's plugin loader does, and holds the
 * dry-run store named after its own pid, as the workers it forks make it.
 */
function strykerMain(end: string): string {
  return [
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    `await import(${src('index.ts')});`,
    `const { lzDryRunDir } = await import(${src('dry-run-store.ts')});`,
    'const dir = lzDryRunDir(process.pid);',
    'mkdirSync(dir);',
    "writeFileSync(join(dir, 'peak'), '100');",
    'process.stdout.write(dir);',
    end,
  ].join('\n');
}

/** Builds a runner, as a test file under `node --test` does, and runs a dry run that records each file's peak. */
const dryRunInOwnProcess = [
  `const { LzStrykerNodeTestRunner } = await import(${src('index.ts')});`,
  "const log = Object.fromEntries(['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((level) => [level, () => {}]));",
  'Object.assign(log, { isTraceEnabled: () => false, isDebugEnabled: () => false, isInfoEnabled: () => false });',
  'const runner = new LzStrykerNodeTestRunner(',
  "  { allowEmpty: false, testFiles: [], checkers: [], timeoutFactor: 1.5, lzStrykerNodeTest: { testFiles: ['a.test.mjs'] } },",
  '  log,',
  ');',
  'await runner.init();',
  "const { status } = await runner.dryRun({ timeout: 10_000, disableBail: false, coverageAnalysis: 'off' });",
  'await runner.dispose();',
  'process.stdout.write(status);',
].join('\n');

/**
 * Stands in for Stryker's main process that forks a worker for the dry run: the worker inherits its environment, and
 * the main process reports the dry-run stores there are, and what they hold, once the worker has ended.
 */
const strykerMainWithWorker = [
  "import { spawnSync } from 'node:child_process';",
  "import { readdirSync } from 'node:fs';",
  "import { tmpdir } from 'node:os';",
  "import { join } from 'node:path';",
  `await import(${src('index.ts')});`,
  'const worker = spawnSync(',
  '  process.execPath,',
  `  ['--conditions=@lz-node-test/source', '--input-type=module', '--eval', ${JSON.stringify(dryRunInOwnProcess)}],`,
  "  { encoding: 'utf8', windowsHide: true },",
  ');',
  'const stores = readdirSync(tmpdir())',
  "  .filter((name) => name.startsWith('lz-stryker-node-test-dry-run-'))",
  '  .flatMap((name) => [',
  "    name.replace(`-${process.pid}-`, '-<main>-'),",
  "    ...readdirSync(join(tmpdir(), name)).map((record) => record.replace(/^[0-9a-f]{64}/, '<file>')).sort(),",
  '  ]);',
  "process.stdout.write([worker.stdout, ...stores].join(' '));",
].join('\n');

function ownEnv(tmp: string): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(([key]) => !key.startsWith('LZ_STRYKER_NODE_TEST_'));

  return { ...Object.fromEntries(inherited), TMP: tmp, TEMP: tmp, TMPDIR: tmp };
}

function storesIn(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith('lz-stryker-node-test-dry-run-'));
}

/** A temporary directory with a project of one passing test file, for a process to run in with that TEMP. */
function projectIn(t: TestContext): { tmp: string; project: string } {
  const tmp = mkdtempSync(join(tmpdir(), 'lz-dry-run-exit-'));
  t.after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });
  const project = join(tmp, 'project');
  mkdirSync(project);
  writeFileSync(join(project, 'a.test.mjs'), "import { it } from 'node:test';\nit('passes', () => {});\n");

  return { tmp, project };
}

describe('the runner module in a process whose parent never loads it', () => {
  it('removes the dry-run store when the process ends', (t) => {
    const { tmp, project } = projectIn(t);

    const child = spawnSync(
      process.execPath,
      ['--conditions=@lz-node-test/source', '--input-type=module', '--eval', dryRunInOwnProcess],
      { cwd: project, env: ownEnv(tmp), encoding: 'utf8', windowsHide: true },
    );

    assert.equal(child.stdout, 'complete', child.stderr);
    assert.deepEqual(storesIn(tmp), []);
  });
});

describe("the runner module in Stryker's main process", () => {
  it("keeps a forked worker's dry-run peaks and start-up times under its own pid and removes them when it ends", (t) => {
    const { tmp, project } = projectIn(t);

    const child = spawnSync(
      process.execPath,
      ['--conditions=@lz-node-test/source', '--input-type=module', '--eval', strykerMainWithWorker],
      { cwd: project, env: ownEnv(tmp), encoding: 'utf8', windowsHide: true },
    );
    assert.equal(
      child.stdout,
      'complete lz-stryker-node-test-dry-run-<main>-store <file>.peak <file>.start-up',
      child.stderr,
    );
    assert.deepEqual(storesIn(tmp), []);
  });

  lzTestFor<readonly [string, string]>([
    ['ends by itself', ''],
    ['calls process.exit', 'process.exit(1);'],
  ])('removes the dry-run store when the process %s', ([, end], t) => {
    const tmp = mkdtempSync(join(tmpdir(), 'lz-dry-run-exit-'));
    t.after(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    const child = spawnSync(
      process.execPath,
      ['--conditions=@lz-node-test/source', '--input-type=module', '--eval', strykerMain(end)],
      { env: ownEnv(tmp), encoding: 'utf8', windowsHide: true },
    );
    const dir = child.stdout;

    assert.ok(dir.startsWith(tmp), `the child made no dry-run store: ${child.stderr}`);
    assert.equal(existsSync(dir), false);
  });
});
