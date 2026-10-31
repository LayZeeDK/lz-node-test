import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import timers from 'node:timers/promises';

import { lzTestEach, lzTestFor } from '@layzee/lz-node-test';
import { endGroup, groupOptions, processEnd } from '../../src/process-end.ts';

describe('groupOptions', () => {
  lzTestEach<[NodeJS.Platform, { detached: boolean; windowsHide: boolean }]>([
    ['linux', { detached: true, windowsHide: true }],
    ['darwin', { detached: true, windowsHide: true }],
    ['win32', { detached: false, windowsHide: true }],
  ])('spawns a test file on %s with %j', (platform, options) => {
    assert.deepEqual(groupOptions(platform), options);
  });
});

/** What ending the group of process 123 sends while the group lasts. */
const groupEnded = [
  [-123, 'SIGTERM'],
  [-123, 'SIGKILL'],
];

describe('endGroup', () => {
  const gone = Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });

  function setup(platform: NodeJS.Platform, error?: unknown, failing: NodeJS.Signals = 'SIGTERM') {
    const calls: unknown[][] = [];
    const end = () =>
      endGroup(123, platform, (pid, signal) => {
        calls.push([pid, signal]);

        if (error && signal === failing) {
          throw error;
        }
      });

    return { calls, end };
  }

  it("asks a POSIX test file's process group to end, then kills it 200 ms later", async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { calls, end } = setup('linux');

    const ended = end();
    t.mock.timers.tick(199);

    assert.deepEqual(calls, [[-123, 'SIGTERM']]);

    t.mock.timers.tick(1);
    await ended;

    assert.deepEqual(calls, groupEnded);
  });

  it('leaves Windows, where the processes end with the test file, alone', async () => {
    const { calls, end } = setup('win32');

    await end();

    assert.deepEqual(calls, []);
  });

  it('neither waits nor kills when no group is left to ask', async (t) => {
    // eslint-disable-next-line node-test/require-mock-timers-advance -- time stands still, so a wait would never end
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { calls, end } = setup('linux', gone);

    await end();

    assert.deepEqual(calls, [[-123, 'SIGTERM']]);
  });

  it('takes a group that ended while it waited as ended', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { calls, end } = setup('linux', gone, 'SIGKILL');
    const ended = end();
    t.mock.timers.tick(200);

    await ended;

    assert.deepEqual(calls, groupEnded);
  });

  lzTestFor<readonly [string, NodeJS.Signals, unknown]>([
    ['an Error with another code', 'SIGTERM', Object.assign(new Error('kill EPERM'), { code: 'EPERM' })],
    ['an Error without a code', 'SIGTERM', new Error('kill failed')],
    ['an object with the code ESRCH that is no Error', 'SIGTERM', { code: 'ESRCH' }],
    ['a string', 'SIGTERM', 'ESRCH'],
    ['an Error with another code', 'SIGKILL', Object.assign(new Error('kill EPERM'), { code: 'EPERM' })],
  ])('rejects with %s that sending %s throws', async ([, failing, thrown], t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const ended = setup('linux', thrown, failing).end();
    t.mock.timers.tick(200);

    await assert.rejects(ended, (error) => error === thrown);
  });
});

describe('processEnd', () => {
  function ending(
    graceMs: number,
    platform: NodeJS.Platform = 'win32',
    options: { pid?: number | undefined; killError?: Error } = {},
  ) {
    const { killError } = options;
    const pid = 'pid' in options ? options.pid : 123;
    const child = Object.assign(new EventEmitter(), { pid, stderr: new PassThrough() });
    const kills: unknown[][] = [];
    const end = processEnd(child, graceMs, platform, (target, signal) => {
      kills.push([target, signal]);

      if (killError) {
        throw killError;
      }
    });
    let state: unknown = 'pending';
    end.then(
      (value) => (state = value),
      (error: unknown) => (state = error),
    );
    const settled = async () => {
      await timers.setImmediate();

      return state;
    };

    return { child, settled, kills };
  }

  it("ends what is left of a POSIX process's group once the process ends and stderr closes, before it ends", async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const closes = ending(1_000, 'linux');
    closes.child.emit('exit', 0);
    await closes.settled();

    assert.deepEqual(closes.kills, []);

    closes.child.emit('close', 0);

    assert.equal(await closes.settled(), 'pending');

    t.mock.timers.tick(200);

    assert.deepEqual(await closes.settled(), { exitCode: 0, stderr: '' });
    assert.deepEqual(closes.kills, groupEnded);
  });

  it("ends what is left of a POSIX process's group once the process ends and stderr stays open", async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const staysOpen = ending(1_000, 'linux');
    staysOpen.child.emit('exit', 0);
    t.mock.timers.tick(1_000);
    // Node.js closes the process once the grace period lets go of stderr.
    staysOpen.child.emit('close', 0);
    t.mock.timers.tick(200);
    await staysOpen.settled();

    assert.deepEqual(staysOpen.kills, groupEnded);
  });

  it('ends no group of a process that failed to start, which has no pid', async () => {
    const { child, settled, kills } = ending(1_000, 'linux', { pid: undefined });
    const failure = new Error('spawn EAGAIN');
    child.emit('error', failure);
    child.emit('close', -2);

    assert.equal(await settled(), failure);
    assert.deepEqual(kills, []);
  });

  it("fails with the error that ending the process's group throws", async () => {
    const denied = Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    const { child, settled } = ending(1_000, 'linux', { killError: denied });
    child.emit('exit', 0);
    child.emit('close', 0);

    assert.equal(await settled(), denied);
  });

  it('ends when the process closes its stdio, with its exit code and stderr, without waiting', async (t) => {
    // eslint-disable-next-line node-test/require-mock-timers-advance -- time stands still, so the 1_000 ms grace never ends the wait
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { child, settled } = ending(1_000);
    child.stderr.write('first ');
    child.stderr.write('second');
    await settled();
    child.emit('exit', 3);
    child.emit('close', 3);

    assert.deepEqual(await settled(), { exitCode: 3, stderr: 'first second' });
  });

  it('stops waiting out the grace period once stderr closes', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { child, settled } = ending(1_000);
    child.emit('exit', 0);
    child.emit('close', 0);
    await settled();
    t.mock.timers.tick(1_000);

    assert.equal(child.stderr.destroyed, false);
  });

  it('ends `graceMs` after the process exits when stderr stays open, and lets go of stderr', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { child, settled } = ending(1_000);
    child.stderr.write('before exit');
    await settled();
    child.emit('exit', 1);
    t.mock.timers.tick(999);

    assert.equal(await settled(), 'pending');

    t.mock.timers.tick(1);

    assert.deepEqual(await settled(), { exitCode: 1, stderr: 'before exit' });
    assert.equal(child.stderr.destroyed, true);
  });

  it('fails when the process cannot start', async () => {
    const { child, settled } = ending(1_000);
    const failure = new Error('spawn ENOENT');
    child.emit('error', failure);

    assert.equal(await settled(), failure);
  });
});
