import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import timers from 'node:timers/promises';

import { lzTestFor } from '@layzee/node-test-extensions';
import { isRunning } from '../../src/dirs.ts';
import { hookedEnv, readRecords, runTestFile, tempDir } from '../hook.fixtures.ts';
import { fixture, hookUrl, reporterArg, shareCompileCache } from '../runner.fixtures.ts';
import { envNames } from '../../src/record.ts';

// Loaded here, outside any test, the hook stays inactive (the runner did not start this process, or its own hook is
// installed), and Stryker counts the hook's mutants as covered by every test, including those that run it in a child.
await import('../../src/hook.ts');

shareCompileCache();

describe('hook, in a process that a signal ends', () => {
  const noSignals = process.platform === 'win32' && 'Windows has no signals to catch: every kill is TerminateProcess';

  /** Starts a process the runner's test file started, running `script` once it says it is ready, and sends `signal`. */
  async function signalled(t: TestContext, script: string, signal: NodeJS.Signals, outDir = tempDir(t)) {
    const child = spawn(process.execPath, ['--import', hookUrl, '-e', `${script} process.send('ready');`], {
      env: hookedEnv({ [envNames.out]: outDir }),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    });
    t.after(() => child.kill('SIGKILL'));
    const exited = once(child, 'exit');
    await once(child, 'message');
    child.kill(signal);
    await exited;

    return {
      code: child.exitCode,
      signalCode: child.signalCode,
      records: existsSync(outDir) ? Object.keys(readRecords(outDir)) : [],
    };
  }

  it(
    "adds no signal listener to the test file's own process, which a test there could count",
    // eslint-disable-next-line node-test/no-skip-test -- POSIX only, with the reason as its value
    { skip: noSignals },
    async (t) => {
      const { code } = await runTestFile(
        t,
        fixture("it('counts', () => { assert.equal(process.listenerCount('SIGTERM'), 0); });"),
      );

      // Stryker disable next-line LzNodeTestAssertCall: runs on POSIX only, where the Linux run of this test checks it
      assert.equal(code, 0);
    },
  );

  lzTestFor<readonly [NodeJS.Signals]>([['SIGTERM'], ['SIGINT'], ['SIGHUP']])(
    'writes the record of a process that %s ends, which ends by that signal as it would without the hook',
    { skip: noSignals },
    async ([signal], t) => {
      const { code, signalCode, records } = await signalled(t, 'setInterval(() => {}, 1_000);', signal);

      // Stryker disable next-line LzNodeTestAssertCall: runs on POSIX only, where the Linux run of this test checks it
      assert.deepEqual([code, signalCode], [null, signal]);
      // Stryker disable next-line LzNodeTestAssertCall: runs on POSIX only, where the Linux run of this test checks it
      assert.equal(records.length, 1);
    },
  );

  it(
    'writes the record of a process with a SIGTERM listener of its own, which decides how the process ends',
    // eslint-disable-next-line node-test/no-skip-test -- POSIX only, with the reason as its value
    { skip: noSignals },
    async (t) => {
      const script = "process.on('SIGTERM', () => process.exit(7)); setInterval(() => {}, 1_000);";

      const { code, signalCode, records } = await signalled(t, script, 'SIGTERM');

      // Stryker disable next-line LzNodeTestAssertCall: runs on POSIX only, where the Linux run of this test checks it
      assert.deepEqual([code, signalCode], [7, null]);
      // Stryker disable next-line LzNodeTestAssertCall: runs on POSIX only, where the Linux run of this test checks it
      assert.equal(records.length, 1);
    },
  );

  it(
    'ends a process that swallows uncaught errors by the signal, also once its record can no longer be written',
    // eslint-disable-next-line node-test/no-skip-test -- POSIX only, with the reason as its value
    { skip: noSignals, timeout: 10_000 },
    async (t) => {
      const script = "process.on('uncaughtException', () => {}); setInterval(() => {}, 1_000);";

      const { code, signalCode } = await signalled(t, script, 'SIGTERM', join(tempDir(t), 'removed'));

      // Stryker disable next-line LzNodeTestAssertCall: runs on POSIX only, where the Linux run of this test checks it
      assert.deepEqual([code, signalCode], [null, 'SIGTERM']);
    },
  );
});

describe('hook, in a test file whose runner is gone', () => {
  const noGroups = process.platform === 'win32' && 'Windows has no process groups; a job object ends the test file';

  it(
    "ends the test file's process group once the process that started it is gone",
    // eslint-disable-next-line node-test/no-skip-test -- POSIX only, with the reason as its value
    { skip: noGroups, timeout: 15_000 },
    async (t) => {
      const dir = tempDir(t);
      const testFile = join(dir, 'fixture.test.mjs');
      writeFileSync(
        testFile,
        fixture(
          "import { writeFileSync } from 'node:fs';",
          "it('never settles', () => new Promise(() => { writeFileSync('started', ''); setInterval(() => {}, 1_000); }));",
        ),
      );
      // Starts the test file as the runner does, in a group of its own with the runner's pid, and sends its pid.
      const script = [
        "const { spawn } = require('node:child_process');",
        `const env = { ...process.env, ${JSON.stringify(envNames.runner)}: String(process.pid) };`,
        "const options = { detached: true, windowsHide: true, stdio: 'ignore', env };",
        `const child = spawn(process.execPath, ${JSON.stringify(['--import', hookUrl, reporterArg, testFile])}, options);`,
        'process.send(child.pid);',
        'setInterval(() => {}, 1_000);',
      ].join(' ');
      const runner = spawn(process.execPath, ['-e', script], {
        cwd: dir,
        env: hookedEnv({ [envNames.out]: tempDir(t), [envNames.file]: testFile }),
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
      });
      const started: number[] = [];
      t.after(() => {
        runner.kill('SIGKILL');
        started
          .filter((pid) => isRunning(pid))
          .forEach((pid) => {
            process.kill(pid, 'SIGKILL');
          });
      });
      const received: unknown[] = await once(runner, 'message');
      const group = -Number(received[0]);
      started.push(group);
      const startBy = performance.now() + 5_000;

      while (!existsSync(join(dir, 'started')) && performance.now() < startBy) {
        await timers.setTimeout(20);
      }

      // Stryker disable next-line LzNodeTestAssertCall: runs on POSIX only, where the Linux run of this test checks it
      assert.ok(existsSync(join(dir, 'started')), 'the test file started its test');
      const exited = once(runner, 'exit');
      runner.kill('SIGKILL');
      await exited;
      const deadline = performance.now() + 5_000;

      while (isRunning(group) && performance.now() < deadline) {
        await timers.setTimeout(50);
      }

      // Stryker disable next-line LzNodeTestAssertCall: runs on POSIX only, where the Linux run of this test checks it
      assert.equal(isRunning(group), false);
    },
  );
});
