import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe } from 'node:test';
import { pathToFileURL } from 'node:url';

import { lzTestFor } from '@layzee/lz-node-test';

const src = (file: string) => JSON.stringify(pathToFileURL(join(import.meta.dirname, '../../src', file)).href);

/**
 * Stands in for Stryker's main process: it imports the plugin entry, as Stryker's plugin loader does, and holds the
 * dry-run peaks directory named after its own pid, as the workers it forks make it.
 */
function strykerMain(end: string): string {
  return [
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    `await import(${src('index.ts')});`,
    `const { peakMemoryDir } = await import(${src('memory-limits.ts')});`,
    'const dir = peakMemoryDir(process.pid);',
    'mkdirSync(dir);',
    "writeFileSync(join(dir, 'peak'), '100');",
    'process.stdout.write(dir);',
    end,
  ].join('\n');
}

describe("the runner module in Stryker's main process", () => {
  lzTestFor<readonly [string, string]>([
    ['ends by itself', ''],
    ['calls process.exit', 'process.exit(1);'],
  ])('removes the dry-run peaks directory when the process %s', ([, end], t) => {
    const tmp = mkdtempSync(join(tmpdir(), 'lz-peaks-exit-'));
    t.after(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    const child = spawnSync(
      process.execPath,
      ['--conditions=@lz-node-test/source', '--input-type=module', '--eval', strykerMain(end)],
      { env: { ...process.env, TMP: tmp, TEMP: tmp, TMPDIR: tmp }, encoding: 'utf8', windowsHide: true },
    );
    const dir = child.stdout;

    assert.ok(dir.startsWith(tmp), `the child made no peaks directory: ${child.stderr}`);
    assert.equal(existsSync(dir), false);
  });
});
