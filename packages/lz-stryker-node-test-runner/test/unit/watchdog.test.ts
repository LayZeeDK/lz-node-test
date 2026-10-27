import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzTestFor } from '@layzee/lz-node-test';
import { checkMemory, watch, workersAllowed } from '../../src/watchdog.ts';

const data = { limitMB: 200, recordPath: '/out/4321.memory.json' };
const mb = 1048576;

function check(rssBytes: number) {
  const writes: unknown[][] = [];
  const kills: unknown[][] = [];
  checkMemory(
    data,
    rssBytes,
    (path, data) => writes.push([path, JSON.parse(data)]),
    (pid, signal) => kills.push([pid, signal]),
  );

  return { writes, kills };
}

describe('workersAllowed', () => {
  lzTestFor<readonly [string, boolean | undefined, boolean]>([
    ['outside the permission model', undefined, true],
    ['under the permission model with workers', true, true],
    ['under the permission model without workers', false, false],
  ])('lets a process start workers %s, or not', ([, allowed, expected]) => {
    const asked: string[] = [];
    const permission =
      allowed === undefined
        ? undefined
        : {
            has: (scope: string) => {
              asked.push(scope);

              return allowed;
            },
          };

    assert.equal(workersAllowed(permission), expected);
    assert.deepEqual(asked, allowed === undefined ? [] : ['worker']);
  });
});

describe('checkMemory', () => {
  it("writes the watchdog's record and ends the process once it holds more than the limit", () => {
    assert.deepEqual(check(200.6 * mb), {
      writes: [[data.recordPath, { tests: [], memoryLimitReached: { rssMB: 201, limitMB: 200 } }]],
      kills: [[process.pid, 'SIGKILL']],
    });
  });

  it('ends the process also when its record cannot be written', () => {
    const kills: unknown[][] = [];

    assert.throws(
      () =>
        checkMemory(
          data,
          200.6 * mb,
          () => {
            throw new Error('ENOENT');
          },
          (pid, signal) => kills.push([pid, signal]),
        ),
      /ENOENT/,
    );
    assert.deepEqual(kills, [[process.pid, 'SIGKILL']]);
  });

  lzTestFor<readonly [string, number]>([
    ['at the limit', 200 * mb],
    ['just below the limit after rounding', 200.4 * mb],
  ])('leaves the process alone %s', ([, rssBytes]) => {
    assert.deepEqual(check(rssBytes), { writes: [], kills: [] });
  });
});

describe('watch', () => {
  it("looks at the process's memory every 50 ms", (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const looks: number[] = [];
    let rss = 0;
    watch(data, () => {
      looks.push(rss);

      return ++rss;
    });

    t.mock.timers.tick(49);
    assert.deepEqual(looks, []);
    t.mock.timers.tick(1);
    t.mock.timers.tick(50);

    assert.deepEqual(looks, [0, 1]);
  });

  it("measures the process's resident memory by default", (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const rss = t.mock.method(process.memoryUsage, 'rss', () => 1);
    watch(data);

    t.mock.timers.tick(50);

    assert.equal(rss.mock.callCount(), 1);
  });
});
