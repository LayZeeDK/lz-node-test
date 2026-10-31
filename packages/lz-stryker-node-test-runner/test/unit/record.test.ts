import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { lzTestEach } from '@layzee/lz-node-test';
import { lzTestFor } from '@layzee/lz-node-test';
import {
  lzIsRecordName,
  lzNodeRecordFiles,
  lzParseRecord,
  lzParseRecordName,
  lzRecordNonce,
  type LzRecordName,
  lzTempRecordPath,
  lzWriteRecord,
  memoryRecordName,
  recordName,
  testId,
  uniqueIds,
} from '../../src/record.ts';

const file = join('/repo', 'a.test.mjs');
// Fixed, as the record-name tests carry it in their names, which Stryker selects a mutant's tests by.
const nonce = 'c2563c34-4f2f-439d-962d-51e1663f0dcd';

describe('testId', () => {
  lzTestFor<readonly [string, string]>([
    ['a > b', `${file} > a \\> b`],
    ['x > > y', `${file} > x \\> \\> y`],
    ['> a', `${file} > \\> a`],
    ['a >', `${file} > a \\>`],
    ['>', `${file} > \\>`],
    ['a \\ > b', `${file} > a \\\\ \\> b`],
  ])('escapes `>` and `\\` in a name whose `>` could form the separator: %j', ([name, id]) => {
    assert.equal(testId(file, name), id);
  });

  lzTestEach(['a name', 'a \\ b', 'a \\> b', '<anonymous>', 'a -> b', 'a >b', 'a> b', ' >b', 'b> '])(
    'leaves a name whose `>` cannot form the separator as it is: %j',
    (name) => {
      assert.equal(testId(file, name), `${file} > ${name}`);
    },
  );
});

describe('uniqueIds', () => {
  it('numbers the suites and tests that would share an id from 2, in the order they are named', () => {
    const idOf = uniqueIds();

    assert.deepEqual(
      [
        idOf(file, 'works'),
        idOf(file, 'works'),
        idOf(file, 'works (2)'),
        idOf(file, 'works'),
        idOf(testId(file, 's'), 'works'),
      ],
      [
        `${file} > works`,
        `${file} > works (2)`,
        `${file} > works (2) (2)`,
        `${file} > works (3)`,
        `${file} > s > works`,
      ],
    );
  });
});

describe('lzIsRecordName', () => {
  lzTestEach([
    recordName(4321, 0, nonce),
    recordName(4321, 3, nonce),
    recordName(4321, 12, nonce),
    memoryRecordName(4321, nonce),
  ])('takes %s as a record', (name) => {
    assert.equal(lzIsRecordName(name), true);
  });

  lzTestEach([
    lzTempRecordPath(recordName(4321, 0, nonce)),
    lzTempRecordPath(memoryRecordName(4321, nonce)),
    `a${recordName(4321, 0, nonce)}`,
    `a${memoryRecordName(4321, nonce)}`,
    '4321.0.json',
    'notes.json',
    '4321.0.js',
  ])('takes %s as no record', (name) => {
    assert.equal(lzIsRecordName(name), false);
  });

  it('takes the name of a record with a nonce from lzRecordNonce as a record', () => {
    assert.equal(lzIsRecordName(recordName(4321, 0, lzRecordNonce())), true);
  });
});

describe('lzParseRecordName', () => {
  lzTestFor<readonly [string, LzRecordName | undefined]>([
    [recordName(4321, 3, nonce), { pid: 4321, thread: 3, nonce }],
    [recordName(4321, 12, nonce), { pid: 4321, thread: 12, nonce }],
    [memoryRecordName(4321, nonce), { pid: 4321, thread: 'memory', nonce }],
    [lzTempRecordPath(recordName(4321, 3, nonce)), undefined],
  ])('reads %s as %j', ([name, parsed]) => {
    assert.deepEqual(lzParseRecordName(name), parsed);
  });
});

describe('lzWriteRecord', () => {
  const path = join('/out', recordName(4321, 0, lzRecordNonce()));
  const written = ['write', lzTempRecordPath(path), '{"tests":[]}'];
  const renamed = ['rename', lzTempRecordPath(path), path];

  /** Writes a record on `platform` where each rename fails with the next code of `failures`, and then succeeds. */
  function writeRecord(platform: NodeJS.Platform, failures: readonly string[]) {
    const calls: unknown[][] = [];
    let attempt = 0;
    const write = () => {
      lzWriteRecord(
        path,
        { tests: [] },
        {
          write: (to, data) => calls.push(['write', to, data]),
          rename: (from, to) => {
            calls.push(['rename', from, to]);
            const code = failures[attempt];
            attempt += 1;

            if (code !== undefined) {
              throw Object.assign(new Error(code), { code });
            }
          },
          pause: (ms) => calls.push(['pause', ms]),
          platform,
        },
      );
    };

    return { calls, write };
  }

  it('writes the record to its temporary file and renames that over the record', () => {
    const { calls, write } = writeRecord('linux', []);

    write();

    assert.deepEqual(calls, [written, renamed]);
  });

  lzTestEach(['EPERM', 'EBUSY'])(
    'renames again 10 ms later on Windows when the rename fails with %s, as while another process reads the record',
    (code) => {
      const { calls, write } = writeRecord('win32', [code]);

      write();

      assert.deepEqual(calls, [written, renamed, ['pause', 10], renamed]);
    },
  );

  it('throws the error of the fifth rename on Windows when every rename fails', () => {
    const { calls, write } = writeRecord('win32', ['EPERM', 'EBUSY', 'EPERM', 'EBUSY', 'EPERM', 'EBUSY']);

    assert.throws(write, { code: 'EPERM' });
    assert.deepEqual(calls, [written, ...[1, 2, 3, 4].flatMap(() => [renamed, ['pause', 10]]), renamed]);
  });

  lzTestFor<readonly [NodeJS.Platform, string]>([
    ['linux', 'EPERM'],
    ['win32', 'ENOENT'],
  ])('throws the error of a failed rename at once on %s for %s', ([platform, code]) => {
    const { calls, write } = writeRecord(platform, [code]);

    assert.throws(write, { code });
    assert.deepEqual(calls, [written, renamed]);
  });
});

describe('lzNodeRecordFiles', () => {
  it('blocks the thread for the pause it is asked for', () => {
    const started = performance.now();

    lzNodeRecordFiles.pause(50);

    const waited = performance.now() - started;
    assert.ok(waited >= 50, `${waited} ms`);
  });
});

describe('lzParseRecord', () => {
  it('returns the record a process wrote', () => {
    const record = { main: true, tests: [{ id: `${file} > t`, status: 'passed', timeSpentMs: 1 }], hitCount: 3 };

    assert.deepEqual(lzParseRecord(JSON.stringify(record)), record);
  });

  it('returns a record with every field', () => {
    const record = {
      main: true,
      tests: [
        { id: `${file} > t`, status: 'passed', timeSpentMs: 1, startPosition: { line: 2, column: 3 } },
        { id: `${file} > u`, status: 'failed', failureMessage: 'boom', timeSpentMs: 0 },
        { id: `${file} > v`, status: 'skipped', timeSpentMs: 0 },
      ],
      hitCount: 3,
      mutantCoverage: { static: { '1': 2 }, perTest: { [`${file} > t`]: { '3': 1 } } },
      peakMemoryMB: 40,
      memoryLimitReached: { rssMB: 300, limitMB: 200 },
      diagnostics: ['late error'],
      unfinished: true,
      heldOpen: ['TCPServerWrap'],
      lifetime: { start: 10, end: 20 },
      testSpans: {
        [`${file} > t`]: [
          { start: 11, end: 13 },
          { start: 15, end: 19 },
        ],
      },
    };

    assert.deepEqual(lzParseRecord(JSON.stringify(record)), record);
  });

  lzTestFor(['null', '[]', '1'])('refuses %s, which is no record', (json) => {
    assert.throws(() => lzParseRecord(json), { message: 'not a record of test results' });
  });

  const test = { id: `${file} > t`, status: 'passed', timeSpentMs: 1 };
  const withFields = (fields: object) => JSON.stringify({ tests: [test], ...fields });
  const withTestFields = (fields: object) => JSON.stringify({ tests: [{ ...test, ...fields }] });

  lzTestEach([
    ['{}', 'tests'],
    ['{"tests":{}}', 'tests'],
    ['{"tests":[1]}', 'tests[0]'],
    [withTestFields({ id: 1 }), 'tests[0].id'],
    [JSON.stringify({ tests: [test, { ...test, id: null }] }), 'tests[1].id'],
    [withTestFields({ status: 'done' }), 'tests[0].status'],
    [withTestFields({ failureMessage: 1 }), 'tests[0].failureMessage'],
    [withTestFields({ timeSpentMs: '1' }), 'tests[0].timeSpentMs'],
    [withTestFields({ startPosition: { line: 1 } }), 'tests[0].startPosition'],
    [withTestFields({ startPosition: { line: '1', column: 2 } }), 'tests[0].startPosition'],
    [withTestFields({ startPosition: null }), 'tests[0].startPosition'],
    [withFields({ main: false }), 'main'],
    [withFields({ hitCount: '3' }), 'hitCount'],
    [withFields({ mutantCoverage: { static: {} } }), 'mutantCoverage'],
    [withFields({ mutantCoverage: { perTest: {} } }), 'mutantCoverage'],
    [withFields({ mutantCoverage: { static: { '1': '2' }, perTest: {} } }), 'mutantCoverage'],
    [withFields({ mutantCoverage: { static: { '1': 2, '3': '4' }, perTest: {} } }), 'mutantCoverage'],
    [withFields({ mutantCoverage: { static: {}, perTest: { t: 1 } } }), 'mutantCoverage'],
    [withFields({ mutantCoverage: { static: {}, perTest: { t: { '1': '2' } } } }), 'mutantCoverage'],
    [withFields({ peakMemoryMB: '40' }), 'peakMemoryMB'],
    [withFields({ memoryLimitReached: { rssMB: 300 } }), 'memoryLimitReached'],
    [withFields({ memoryLimitReached: { limitMB: 200 } }), 'memoryLimitReached'],
    [withFields({ diagnostics: 'late error' }), 'diagnostics'],
    [withFields({ diagnostics: [1] }), 'diagnostics'],
    [withFields({ unfinished: false }), 'unfinished'],
    [withFields({ heldOpen: [null] }), 'heldOpen'],
    [withFields({ lifetime: { start: 1 } }), 'lifetime'],
    [withFields({ lifetime: { start: '1', end: 2 } }), 'lifetime'],
    [withFields({ testSpans: [] }), 'testSpans'],
    [withFields({ testSpans: { t: { start: 1, end: 2 } } }), 'testSpans'],
    [withFields({ testSpans: { t: [{ end: 2 }] } }), 'testSpans'],
    [withFields({ testSpans: { t: [{ start: 1, end: 2 }, { end: 4 }] } }), 'testSpans'],
  ])('refuses %s, naming %s', (json, field) => {
    assert.throws(() => lzParseRecord(json), { message: `not a record of test results: ${field}` });
  });

  it('refuses what does not parse', () => {
    assert.throws(() => lzParseRecord('{'), SyntaxError);
  });
});
