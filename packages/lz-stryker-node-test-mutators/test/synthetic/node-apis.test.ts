import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { Readable, Writable } from 'node:stream';
import { describe, it, mock } from 'node:test';
import timers from 'node:timers';
import timersPromises from 'node:timers/promises';

import { lzTestEach } from '@layzee/lz-node-test';
import { closed, idle, later, onEnd, onFinish, onIdle, onSent, pause, poll, share, total, wait } from './node-apis.ts';

const MS = 10;

interface TimerMock {
  mock: { readonly calls: readonly { readonly arguments: unknown }[]; restore(): void };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const timer = () => ({ unref() {} });

async function callsOf(mockTimer: () => TimerMock, run: () => unknown): Promise<unknown[]> {
  const fake = mockTimer();
  syncBuiltinESMExports();

  try {
    await run();

    return fake.mock.calls.map((call) => call.arguments);
  } finally {
    fake.mock.restore();
    syncBuiltinESMExports();
  }
}

describe('the timers', () => {
  const callback = () => {};

  lzTestEach([
    ['pause', () => mock.method(timersPromises, 'setTimeout', timer), () => pause(MS), [MS]],
    ['wait', () => mock.method(timersPromises.scheduler, 'wait', timer), () => wait(MS), [MS]],
    ['later', () => mock.method(timers, 'setTimeout', timer), () => later(callback, MS), [callback, MS]],
    ['idle', () => mock.method(globalThis, 'setTimeout', timer), () => idle(callback, MS), [callback, MS]],
    ['poll', () => mock.method(globalThis, 'setInterval', timer), () => poll(callback), [callback, 100]],
  ])('%s gives the timer its milliseconds', async (_name, mockTimer, run, args) => {
    assert.deepEqual(await callsOf(mockTimer, run), [args]);
  });
});

describe('closed', () => {
  it('resolves once the emitter closes, not when it exits', async () => {
    const emitter = new EventEmitter();
    let settled = false;
    void closed(emitter).then(() => {
      settled = true;
    });

    emitter.emit('exit');
    await settle();
    const afterExit = settled;
    emitter.emit('close');
    await settle();

    assert.deepEqual([afterExit, settled], [false, true]);
  });
});

describe('the stream listeners', () => {
  it('onFinish calls back when the stream finishes, before it closes', async () => {
    const events: string[] = [];
    const stream = new Writable({ write: (_chunk, _encoding, callback) => callback() });
    onFinish(stream, () => events.push('done'));
    stream.on('finish', () => events.push('finish'));
    stream.on('close', () => events.push('close'));

    stream.end('x');
    await once(stream, 'close');

    assert.deepEqual(events, ['done', 'finish', 'close']);
  });

  it('onSent calls back when the raw stream of a reply finishes, before it closes', async () => {
    const events: string[] = [];
    const stream = new Writable({ write: (_chunk, _encoding, callback) => callback() });
    onSent({ raw: stream }, () => events.push('done'));
    stream.on('finish', () => events.push('finish'));
    stream.on('close', () => events.push('close'));

    stream.end('x');
    await once(stream, 'close');

    assert.deepEqual(events, ['done', 'finish', 'close']);
  });

  it('onEnd calls back when the stream ends, before it closes', async () => {
    const events: string[] = [];
    const stream = Readable.from(['x']);
    onEnd(stream, () => events.push('done'));
    stream.on('end', () => events.push('end'));
    stream.on('close', () => events.push('close'));

    stream.resume();
    await once(stream, 'close');

    assert.deepEqual(events, ['done', 'end', 'close']);
  });
});

describe('onIdle', () => {
  it("listens for the process's beforeExit", () => {
    const listener = () => {};
    onIdle(listener);

    try {
      assert.deepEqual(
        [process.listeners('beforeExit').includes(listener), process.listeners('exit').includes(listener)],
        [true, false],
      );
    } finally {
      process.removeListener('beforeExit', listener);
    }
  });
});

describe('the assertions', () => {
  it('share divides a part by a positive whole', () => {
    assert.equal(share(1, 4), 0.25);
    assert.throws(() => share(1, 0), assert.AssertionError);
  });

  it('total multiplies a whole count by a size', () => {
    assert.equal(total(3, 2), 6);
    assert.throws(() => total(1.5, 2), assert.AssertionError);
  });
});
