import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { describe, it } from 'node:test';

import { lzExec } from '../../src/exec.ts';

// Writes to both streams, then waits for the flag file before writing again, so the log can be read mid-run.
const child = `
const { existsSync } = require('node:fs');
process.stdout.write('early\\n');
process.stderr.write('warn\\n');
const wait = setInterval(() => {
  if (existsSync(process.argv[1])) {
    clearInterval(wait);
    process.stdout.write('late\\n');
  }
}, 20);
`;

async function logOnceItHas(path: string, parts: readonly string[]): Promise<string> {
  for (let tries = 0; tries < 500; tries++) {
    const log = existsSync(path) ? readFileSync(path, 'utf8') : '';

    if (parts.every((part) => log.includes(part))) {
      return log;
    }

    await setTimeout(20);
  }

  throw new Error(`${path} never held ${parts.join(', ')}`);
}

describe('lzExec', () => {
  it('writes stdout and stderr to the log file while the process runs, and still returns both', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'lz-exec-'));
    const flag = join(dir, 'flag');
    const logFile = join(dir, 'run.log');

    const running = lzExec(process.execPath, ['-e', child, flag], { cwd: dir, logFile });

    // The flag lets the child end even when the log never fills, so a failure cannot hang the suite.
    t.after(async () => {
      writeFileSync(flag, '');
      await running;
      rmSync(dir, { recursive: true, force: true });
    });
    await logOnceItHas(logFile, ['early\n', 'warn\n']);
    writeFileSync(flag, '');
    const result = await running;

    assert.deepEqual(
      { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
      { stdout: 'early\nlate\n', stderr: 'warn\n', exitCode: 0 },
    );
    assert.equal((await logOnceItHas(logFile, ['late\n'])).length, 'early\nwarn\nlate\n'.length);
  });
});
