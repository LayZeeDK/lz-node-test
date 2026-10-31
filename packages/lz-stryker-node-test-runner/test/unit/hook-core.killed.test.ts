import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzTestFor } from '@layzee/lz-node-test';
import { lzEndingSignals, type LzEndingSignal } from '../../src/hook-core.ts';
import { envNames } from '../../src/record.ts';
import { fileEnv, installedHarness, out } from '../hook-core.fixtures.ts';

const noListeners = { SIGTERM: 0, SIGINT: 0, SIGHUP: 0 };

describe('install, for a process that a signal ends', () => {
  it('listens for SIGTERM, SIGINT and SIGHUP', () => {
    const { listenerCounts } = installedHarness({ [envNames.out]: out });

    assert.deepEqual(listenerCounts(), { SIGTERM: 1, SIGINT: 1, SIGHUP: 1 });
  });

  it('listens for no signal where the platform has none to catch or the process cannot write its record', () => {
    const windows = installedHarness(fileEnv, { signals: undefined });
    const readOnly = installedHarness(fileEnv, { canWriteRecords: false });

    windows.exit();

    assert.equal(windows.records.length, 1);
    assert.deepEqual(readOnly.listenerCounts(), noListeners);
  });

  lzTestFor<readonly [LzEndingSignal]>(lzEndingSignals.map((signal) => [signal]))(
    'writes the record on %s, stops listening and raises the signal again, as no other listener decides how the process ends',
    ([signal]) => {
      const { records, raised, signal: send, listenerCounts } = installedHarness(fileEnv);

      send(signal);

      assert.equal(records.length, 1);
      assert.deepEqual(listenerCounts(), noListeners);
      assert.deepEqual(raised, [signal]);
    },
  );

  it("only writes the record when the process listens for the signal itself, so that the process's listener decides", () => {
    const { records, raised, signal, listen, listenerCounts } = installedHarness(fileEnv);
    const own: string[] = [];
    listen('SIGTERM', () => own.push('SIGTERM'));

    signal('SIGTERM');

    assert.equal(records.length, 1);
    assert.deepEqual(raised, []);
    assert.deepEqual(own, ['SIGTERM']);
    assert.deepEqual(listenerCounts(), { SIGTERM: 2, SIGINT: 1, SIGHUP: 1 });
  });

  lzTestFor<readonly [string, readonly unknown[], readonly LzEndingSignal[]]>([
    ["raises the signal when every other listener is signal-exit's", [{ count: 1 }, { count: 1 }], ['SIGTERM']],
    ['leaves the signal to the other listeners when no signal-exit counts them', [undefined, { count: '2' }], []],
  ])('%s, which leaves how the process ends to any other listener', ([, emitters, expected]) => {
    const { raised, signal, listen, useSignalExit } = installedHarness(fileEnv);
    useSignalExit(emitters);
    listen('SIGTERM', () => {});
    listen('SIGTERM', () => {});

    signal('SIGTERM');

    assert.deepEqual(raised, expected);
  });
});
