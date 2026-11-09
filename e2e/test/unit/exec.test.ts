import assert from 'node:assert/strict';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

  it('ends a process that outlives its timeout, and names the signal that ended it', async () => {
    const result = await lzExec(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: tmpdir(),
      timeoutMs: 300,
    });

    assert.deepEqual(
      { exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut },
      { exitCode: 1, signal: 'SIGTERM', timedOut: true },
    );
  });

  it('records a timeout even when the process exits with its own code on SIGTERM, as Stryker does on Linux', async () => {
    const stryker = "process.on('SIGTERM', () => process.exit(143)); setInterval(() => {}, 1000);";
    const result = await lzExec(process.execPath, ['-e', stryker], { cwd: tmpdir(), timeoutMs: 300 });

    assert.equal(result.timedOut, true);
  });

  it('records no timeout or signal for a process that exits with an error code before its timeout', async () => {
    const result = await lzExec(process.execPath, ['-e', 'process.exit(3)'], { cwd: tmpdir(), timeoutMs: 60_000 });

    assert.deepEqual(
      { exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut },
      { exitCode: 3, signal: null, timedOut: false },
    );
  });

  it('records no timeout for a process that exits before its timeout while a child it started holds its stdout', async () => {
    const parent =
      "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3500)'], " +
      "{ stdio: ['ignore', 'inherit', 'inherit'], detached: true, windowsHide: true }).unref(); process.exit(0);";
    const result = await lzExec(process.execPath, ['-e', parent], { cwd: tmpdir(), timeoutMs: 3_000 });

    assert.deepEqual({ exitCode: result.exitCode, timedOut: result.timedOut }, { exitCode: 0, timedOut: false });
  });

  it('keeps what a process it started writes to the shared stdout and stderr after the process itself exits', async () => {
    const late = "setTimeout(() => { process.stdout.write('late\\n'); process.stderr.write('late\\n'); }, 300);";
    const parent =
      `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(late)}], ` +
      "{ stdio: ['ignore', 'inherit', 'inherit'], detached: true, windowsHide: true }).unref(); " +
      "process.stdout.write('early\\n'); process.stderr.write('early\\n'); process.exit(0);";
    const result = await lzExec(process.execPath, ['-e', parent], { cwd: tmpdir(), timeoutMs: 10_000 });

    assert.deepEqual(
      { stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut },
      { stdout: 'early\nlate\n', stderr: 'early\nlate\n', timedOut: false },
    );
  });

  it('gives the process no input, so a process that reads stdin to its end goes on at once', async () => {
    const reader = "process.stdin.on('end', () => process.stdout.write('ended')).resume();";
    const result = await lzExec(process.execPath, ['-e', reader], { cwd: tmpdir(), timeoutMs: 10_000 });

    assert.deepEqual({ stdout: result.stdout, timedOut: result.timedOut }, { stdout: 'ended', timedOut: false });
  });

  it('rejects for a file that cannot be started, and leaves no timeout timer running', async () => {
    const timers = (): number => process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
    const before = timers();

    await assert.rejects(lzExec('lz-exec-no-such-file', [], { cwd: tmpdir(), timeoutMs: 60_000 }), { code: 'ENOENT' });

    assert.equal(timers(), before);
  });

  it(
    'closes the log file once the process ends, so Windows hands its descriptor out again',
    // eslint-disable-next-line node-test/no-skip-test -- Windows only, with the reason as its value
    { skip: process.platform !== 'win32' && 'Linux may free a lower descriptor during the run' },
    async (t) => {
      const dir = mkdtempSync(join(tmpdir(), 'lz-exec-'));

      t.after(() => {
        rmSync(dir, { recursive: true, force: true });
      });
      const probe = join(dir, 'probe');
      const free = openSync(probe, 'w');

      closeSync(free);
      await lzExec(process.execPath, ['-e', "process.stdout.write('x')"], { cwd: dir, logFile: join(dir, 'run.log') });
      const next = openSync(probe, 'w');

      closeSync(next);
      // Stryker disable next-line LzNodeTestAssertCall: runs on Windows only, so the Linux mutation run cannot reach it
      assert.equal(next, free);
    },
  );

  it(
    'closes the log file once the process ends, so no descriptor of this process points at it on Linux',
    // eslint-disable-next-line node-test/no-skip-test -- Linux only, with the reason as its value
    { skip: process.platform !== 'linux' && 'reads the open descriptors from /proc' },
    async (t) => {
      const dir = mkdtempSync(join(tmpdir(), 'lz-exec-'));

      t.after(() => {
        rmSync(dir, { recursive: true, force: true });
      });
      const logFile = join(dir, 'run.log');

      await lzExec(process.execPath, ['-e', "process.stdout.write('x')"], { cwd: dir, logFile });
      const targets = readdirSync('/proc/self/fd').map((fd) => {
        try {
          return readlinkSync(join('/proc/self/fd', fd));
        } catch {
          return '';
        }
      });

      // Stryker disable next-line LzNodeTestAssertCall: runs on Linux only, so the Windows mutation run cannot reach it
      assert.ok(!targets.includes(realpathSync(logFile)), `still open: ${realpathSync(logFile)}`);
    },
  );
});
